# k6 API Monitoring (production)

Two k6 CronJobs call 8 API endpoints on `https://www.nirmata.io` every 5 minutes (1 user, 1 minute, read-only GETs).
Each probe writes its results to one replica of the `prometheus-new` Prometheus on **eks-prod**. Prometheus evaluates
the alert rules, Alertmanager sends k6 alerts to **#loki-alerts**, and a Grafana dashboard on **eks-manage** shows
performance per endpoint.

```
k6-api-probe-r0 ──writes──► Prometheus replica 0 ─┐
                                                   ├─ alerts ─► Alertmanager ─► #loki-alerts
k6-api-probe-r1 ──writes──► Prometheus replica 1 ─┘
                                (same data) ──► Grafana dashboard (eks-manage)
```

## Files

| File | Creates | Purpose |
| --- | --- | --- |
| `probe.js` | ConfigMap `k6-probe-script` | k6 script: 8 endpoints, checks for HTTP 200, logs status of failures |
| `k8s/k6-cronjob-prod.yaml` | CronJobs `k6-api-probe-r0`, `k6-api-probe-r1` | Run the probe every 5 min, one per Prometheus replica |
| `k8s/k6-alerts-prod.yaml` | PrometheusRule `k6-api-probe-alerts` | 4 alert rules (label `release: prometheus-new`) |
| `k8s/k6-alertmanagerconfig.yaml` | AlertmanagerConfig `k6-api-probe-slack` | Routes alerts labelled `probe: k6` to #loki-alerts |
| `grafana/k6-dashboard.json` | Grafana dashboard (UID `nirmata-k6-api`) | Import into Grafana on eks-manage |

The API key is **not** stored in this repo. It lives only in the Kubernetes Secret `k6-probe-secrets`.

## Endpoints monitored

| Service | Path |
| --- | --- |
| webclient | `/security/login.html` (no auth) |
| environments | `/environments/api/Environment` |
| application | `/environments/api/Application` |
| cluster | `/cluster/api/KubernetesCluster` |
| clustertype | `/cluster/api/ClusterType` |
| policies | `/policies/api/getPolicyReportCategoryTable` |
| catalog | `/catalog/api/Catalogs` |
| users | `/users/api/Users` |

## Alerts

| Alert | Fires when | Severity |
| --- | --- | --- |
| NirmataApiHighLatency | p95 > 2 s for 10 min (all endpoints except users) | warning |
| NirmataUsersApiHighLatency | users p95 > 5 s for 10 min | warning |
| NirmataApiErrors | > 5% failed requests for 10 min | critical |
| K6ProbeNotReporting | no k6 data for 15 min (then 5 min) | warning |

One FIRING and one RESOLVED message per alert; reminders every 4 h while it lasts.

## Prerequisites (already in place on eks-prod)

- `prometheus-new` with `prometheus.prometheusSpec.enableRemoteWriteReceiver=true` (both replicas)
- Headless Service `prometheus-operated` (per-replica addresses)
- Secret `alertmanager-slack-loki` (key `webhook-url`) listed in the Alertmanager `spec.secrets`
- A read-only Nirmata API key for www.nirmata.io

## Deploy (cluster: eks-prod, namespace `monitoring`)

```bash
kubectl config current-context        # must end in cluster/eks-prod

# 1. API key (never commit it)
read -s NIRMATA_PROD_TOKEN && export NIRMATA_PROD_TOKEN
kubectl create secret generic k6-probe-secrets -n monitoring \
  --from-literal=api-token="$NIRMATA_PROD_TOKEN" --dry-run=client -o yaml | kubectl apply -f -

# 2. Script
kubectl create configmap k6-probe-script -n monitoring --from-file=probe.js \
  --dry-run=client -o yaml | kubectl apply -f -

# 3. Probes, alert rules, Slack route
kubectl apply -f k8s/k6-cronjob-prod.yaml
kubectl apply -f k8s/k6-alerts-prod.yaml
kubectl apply -f k8s/k6-alertmanagerconfig.yaml
```

Dashboard: Grafana (grafana-prod.nirmata.co/grafana) → Dashboards → New → Import → upload
`grafana/k6-dashboard.json` → folder *Nirmata Production* → Import (Overwrite if it exists) → data source *Prometheus*.

## Verify

```bash
kubectl get cronjob -n monitoring | grep k6-api-probe          # SUSPEND False, recent LAST SCHEDULE
kubectl logs -n monitoring -l app=k6-api-probe --tail=25      # 48/48 checks per run
```

In Prometheus: `sum by (service) (k6_http_reqs_total)` returns 8 services; Status → Rules shows group `k6-api-probe`.

## Common changes

- **Add or remove an endpoint:** edit `ENDPOINTS` in `probe.js`, then re-run step 2.
- **Change a threshold:** edit the `expr` in `k8s/k6-alerts-prod.yaml`, then `kubectl apply -f k8s/k6-alerts-prod.yaml`.
- **Rotate the API key:** re-run step 1 with the new key.
- **Pause the probes:** set `suspend: true` on both CronJobs. More than ~15 min fires `K6ProbeNotReporting`,
  so warn #loki-alerts or add an Alertmanager silence first.

## Notes

- Each Prometheus replica evaluates rules on its own data, so each probe writes to one replica directly.
  Writing through the load-balanced Service caused false `K6ProbeNotReporting` alerts.
- Panels can differ slightly between refreshes because each replica is fed by its own probe run.
- Image pinned to `grafana/k6:1.8.1`.
