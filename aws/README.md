# AWS Lambda sources (deployed copies)

Single-file `index.handler` Lambdas, python3.12, region us-east-1. These are the exact sources
deployed for M2 (ECPay 定期定額 paywall). The deployed function is the source of truth; keep this
folder in sync when you redeploy.

| Folder | Function | Trigger |
|---|---|---|
| save_subscription | flight-save-subscription | POST /subscribe — writes `pending_payment` + returns the ECPay checkout form, or updates the target in place for paid users |
| ecpay_return | flight-ecpay-return | POST /ecpay-return — ECPay ReturnURL (first charge) → `active` |
| ecpay_period | flight-ecpay-period | POST /ecpay-period — ECPay PeriodReturnURL (renewals) |
| ecpay_result | flight-ecpay-result | ANY /ecpay-result — OrderResultURL browser POST → 302 to /app |
| cancel_subscription | flight-cancel-subscription | POST /cancel — CreditCardPeriodAction Cancel → `cancelled` (grace period) |
| status_notification | flight-status-notification | SQS flight-status-queue — welcome / cancel emails via Resend |
| parser | flight-parser | invoked by flight-parser-wrapper — grace-aware paywall gate |
