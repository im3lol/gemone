variable "project" {
  type        = string
  description = "GCP project id"
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "env" {
  type        = string
  default     = "prod"
  description = "Environment name (staging | prod)"
}

variable "api_image" {
  type        = string
  description = "Fully-qualified api image (Artifact Registry). Set by CI per commit."
}

variable "web_image" {
  type        = string
  description = "Fully-qualified web image."
}

variable "db_tier" {
  type    = string
  default = "db-custom-1-3840"
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "jwt_access_secret" {
  type      = string
  sensitive = true
}

variable "jwt_refresh_secret" {
  type      = string
  sensitive = true
}
