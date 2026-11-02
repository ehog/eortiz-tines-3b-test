Applies an approval decision. Plans that are not pending (already decided, superseded, or expired) are ignored.

On approval, each item is checked again before anything is deleted: it must still exist, still be orphaned, empty, or expired, and still be unprotected. Then it's deleted, with long-running operations polled. Resources go before RGs, and the whole run has a 4-minute budget; items left over are marked `deferred`. IPAM releases free the block only if the RG is still gone.

Every item is recorded under `deletions/` (approver, approval time, outcome) and in the audit volume. The decision is written to `decisions/<plan>.json`, and the step outputs a Slack results summary.
