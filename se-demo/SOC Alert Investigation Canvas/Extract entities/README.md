Linked from `Receive incident`; needs only `investigationId` on stdin and reads the normalized incident from the volume.

Maps the vendor entity list by type (device, account, IP, URL, domain, file, process, mail) and then sweeps the raw payload with regexes, because Sentinel and Defender label the same entity differently. IPs are split into internal (RFC1918, loopback, link-local) and external; only executable file names become process entities; user domains that are not internal become domain indicators.

Writes `<id>/entities.json` and emits the same object on stdout, fanning out to all five enrichment steps.
