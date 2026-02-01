variable "account_id" {
  description = "Cloudflare account ID."
  type        = string
}

variable "zone_id" {
  description = "Cloudflare zone ID for the application domain."
  type        = string
}

variable "domain" {
  description = "Application domain."
  type        = string
  default     = "msgstats.from-trees.com"
}

variable "allowed_emails" {
  description = "Email addresses allowed to access ops dashboards."
  type        = list(string)
  default     = []
}

variable "allowed_group_id" {
  description = "Zero Trust Access group ID allowed to access ops dashboards."
  type        = string
  default     = ""
  validation {
    condition     = length(var.allowed_emails) > 0 || var.allowed_group_id != ""
    error_message = "Provide allowed_emails or allowed_group_id."
  }
}
