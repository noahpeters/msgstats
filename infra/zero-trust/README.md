# Zero Trust Access for Ops Paths

This Terraform config protects the ops dashboard and ops API paths using Cloudflare Access.

## Requirements

- Terraform >= 1.5
- Cloudflare provider authentication (export `CLOUDFLARE_API_TOKEN`)

## Usage

```bash
cd infra/zero-trust
terraform init
terraform apply \
  -var account_id=YOUR_ACCOUNT_ID \
  -var zone_id=YOUR_ZONE_ID \
  -var allowed_emails='["ops@example.com"]'
```

To use an Access group instead of emails:

```bash
terraform apply \
  -var account_id=YOUR_ACCOUNT_ID \
  -var zone_id=YOUR_ZONE_ID \
  -var allowed_group_id=YOUR_GROUP_ID
```
