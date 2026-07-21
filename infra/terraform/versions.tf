terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Remote state — create the bucket once, then uncomment.
  # backend "gcs" {
  #   bucket = "gemone-tfstate"
  #   prefix = "prod"
  # }
}

provider "google" {
  project = var.project
  region  = var.region
}
