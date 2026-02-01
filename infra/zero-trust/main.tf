provider "cloudflare" {}

resource "cloudflare_zero_trust_access_application" "ops_dashboard" {
  account_id       = var.account_id
  name             = "msgstats-ops-dashboard"
  type             = "self_hosted"
  domain           = "${var.domain}/ops-dashboard*"
  session_duration = "24h"
  zone_id          = var.zone_id
}

resource "cloudflare_zero_trust_access_application" "ops_api" {
  account_id       = var.account_id
  name             = "msgstats-ops-api"
  type             = "self_hosted"
  domain           = "${var.domain}/api/ops/*"
  session_duration = "24h"
  zone_id          = var.zone_id
}

resource "cloudflare_zero_trust_access_policy" "ops_dashboard_allow" {
  account_id     = var.account_id
  application_id = cloudflare_zero_trust_access_application.ops_dashboard.id
  name           = "allow-ops-dashboard"
  decision       = "allow"

  dynamic "include" {
    for_each = length(var.allowed_emails) > 0 ? [1] : []
    content {
      email = var.allowed_emails
    }
  }

  dynamic "include" {
    for_each = var.allowed_group_id != "" ? [1] : []
    content {
      group = [var.allowed_group_id]
    }
  }
}

resource "cloudflare_zero_trust_access_policy" "ops_api_allow" {
  account_id     = var.account_id
  application_id = cloudflare_zero_trust_access_application.ops_api.id
  name           = "allow-ops-api"
  decision       = "allow"

  dynamic "include" {
    for_each = length(var.allowed_emails) > 0 ? [1] : []
    content {
      email = var.allowed_emails
    }
  }

  dynamic "include" {
    for_each = var.allowed_group_id != "" ? [1] : []
    content {
      group = [var.allowed_group_id]
    }
  }
}
