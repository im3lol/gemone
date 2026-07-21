locals {
  name = "gemone-${var.env}"
}

# --- Enable required APIs ---
resource "google_project_service" "svc" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "vpcaccess.googleapis.com",
    "servicenetworking.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

# --- Container registry ---
resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "gemone"
  format        = "DOCKER"
  depends_on    = [google_project_service.svc]
}

# --- Network + private services access (for Cloud SQL / Redis private IPs) ---
resource "google_compute_network" "vpc" {
  name                    = "${local.name}-vpc"
  auto_create_subnetworks = true
  depends_on              = [google_project_service.svc]
}

resource "google_compute_global_address" "psa" {
  name          = "${local.name}-psa"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "psa" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.psa.name]
}

# Serverless VPC connector so Cloud Run reaches the private DB + Redis.
resource "google_vpc_access_connector" "connector" {
  name          = "${local.name}-conn"
  region        = var.region
  network       = google_compute_network.vpc.name
  ip_cidr_range = "10.8.0.0/28"
  depends_on    = [google_project_service.svc]
}

# --- Managed Postgres (primary) with backups + PITR ---
resource "google_sql_database_instance" "pg" {
  name                = "${local.name}-pg"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = var.env == "prod"

  settings {
    tier              = var.db_tier
    availability_type = var.env == "prod" ? "REGIONAL" : "ZONAL"

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "03:00"
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.vpc.id
    }
  }

  depends_on = [google_service_networking_connection.psa]
}

# Read replica for read-scaling / reporting.
resource "google_sql_database_instance" "pg_replica" {
  name                 = "${local.name}-pg-replica"
  database_version     = "POSTGRES_16"
  region               = var.region
  master_instance_name = google_sql_database_instance.pg.name
  deletion_protection  = false

  replica_configuration {
    failover_target = false
  }

  settings {
    tier              = var.db_tier
    availability_type = "ZONAL"
    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.vpc.id
    }
  }
}

resource "google_sql_database" "db" {
  name     = "gemone"
  instance = google_sql_database_instance.pg.name
}

resource "google_sql_user" "user" {
  name     = "gemone"
  instance = google_sql_database_instance.pg.name
  password = var.db_password
}

# --- Managed Redis (Memorystore) for BullMQ + rate limiting ---
resource "google_redis_instance" "redis" {
  name               = "${local.name}-redis"
  tier               = var.env == "prod" ? "STANDARD_HA" : "BASIC"
  memory_size_gb     = 1
  region             = var.region
  authorized_network = google_compute_network.vpc.id
  connect_mode       = "PRIVATE_SERVICE_ACCESS"
  redis_version      = "REDIS_7_0"
  depends_on         = [google_service_networking_connection.psa]
}

# --- Secrets ---
resource "google_secret_manager_secret" "db_url" {
  secret_id = "${local.name}-db-url"
  replication { auto {} }
}

resource "google_secret_manager_secret_version" "db_url" {
  secret      = google_secret_manager_secret.db_url.id
  secret_data = "postgresql://gemone:${var.db_password}@${google_sql_database_instance.pg.private_ip_address}:5432/gemone?schema=public"
}

resource "google_secret_manager_secret" "jwt_access" {
  secret_id = "${local.name}-jwt-access"
  replication { auto {} }
}
resource "google_secret_manager_secret_version" "jwt_access" {
  secret      = google_secret_manager_secret.jwt_access.id
  secret_data = var.jwt_access_secret
}

resource "google_secret_manager_secret" "jwt_refresh" {
  secret_id = "${local.name}-jwt-refresh"
  replication { auto {} }
}
resource "google_secret_manager_secret_version" "jwt_refresh" {
  secret      = google_secret_manager_secret.jwt_refresh.id
  secret_data = var.jwt_refresh_secret
}

# --- Cloud Run: shared env for api + worker ---
locals {
  backend_env = {
    REDIS_HOST = google_redis_instance.redis.host
    REDIS_PORT = tostring(google_redis_instance.redis.port)
    NODE_ENV   = "production"
    WEB_ORIGIN = "https://${local.name}.example.com"
  }
  backend_secrets = {
    DATABASE_URL       = google_secret_manager_secret.db_url.secret_id
    JWT_ACCESS_SECRET  = google_secret_manager_secret.jwt_access.secret_id
    JWT_REFRESH_SECRET = google_secret_manager_secret.jwt_refresh.secret_id
  }
}

# API — request-driven, public, RUN_WORKERS=false (enqueue only).
resource "google_cloud_run_v2_service" "api" {
  name     = "${local.name}-api"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    vpc_access {
      connector = google_vpc_access_connector.connector.id
      egress    = "PRIVATE_RANGES_ONLY"
    }
    scaling {
      min_instance_count = var.env == "prod" ? 1 : 0
      max_instance_count = 10
    }
    containers {
      image = var.api_image
      ports { container_port = 4000 }
      env {
        name  = "RUN_WORKERS"
        value = "false"
      }
      dynamic "env" {
        for_each = local.backend_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = local.backend_secrets
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }
}

# Worker — always-on (min 1), CPU always allocated, RUN_WORKERS=true, no ingress.
resource "google_cloud_run_v2_service" "worker" {
  name     = "${local.name}-worker"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  template {
    vpc_access {
      connector = google_vpc_access_connector.connector.id
      egress    = "PRIVATE_RANGES_ONLY"
    }
    scaling {
      min_instance_count = 1
      max_instance_count = 5
    }
    containers {
      image   = var.api_image
      command = ["node", "dist/worker.js"]
      resources {
        cpu_idle = false # keep CPU allocated so the queue worker runs continuously
      }
      env {
        name  = "RUN_WORKERS"
        value = "true"
      }
      dynamic "env" {
        for_each = local.backend_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = local.backend_secrets
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }
}

# Web — public Next.js, talks to the api over the internal URL.
resource "google_cloud_run_v2_service" "web" {
  name     = "${local.name}-web"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    scaling {
      min_instance_count = var.env == "prod" ? 1 : 0
      max_instance_count = 10
    }
    containers {
      image = var.web_image
      ports { container_port = 3000 }
      env {
        name  = "API_URL"
        value = google_cloud_run_v2_service.api.uri
      }
    }
  }
}

# Public invoker for api + web (worker stays internal).
resource "google_cloud_run_v2_service_iam_member" "api_public" {
  name     = google_cloud_run_v2_service.api.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "web_public" {
  name     = google_cloud_run_v2_service.web.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
