Quality gates, and the batch's data-quality score.

**Triggered by** [Normalize](../Normalize/script.ts).

| Reason code | Gate |
| --- | --- |
| `MISSING_NDC` | No National Drug Code after normalization |
| `ZERO_ENROLLMENT` | Enrollment count of 0 |
| `FUTURE_DATE` | Effective date after today |
| `INVALID_DATE` | Date could not be coerced to ISO-8601 |
| `UNMAPPED_COUNTRY` | Site country outside the ISO-3166 map |
| `PRICE_OUTLIER` | List price beyond 3 standard deviations |
| `ENCODING_DAMAGE` | Flagged upstream by Normalize |

The outlier test uses a **leave-one-out** mean and standard deviation: a single
extreme price inflates the batch spread enough to hide itself, so each record is
compared against the other records in the batch.

**Quality score** = published ÷ normalized, as a percentage. Below 85 the run is
marked `degraded` — publishable, but not healthy.

Rejected records never reach [Publish](../Publish/script.ts)'s record table; the
rejections themselves are stored for the console's breakdown.
