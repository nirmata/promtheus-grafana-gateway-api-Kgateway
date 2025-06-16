# Kubernetes Gateway API Setup for Prometheus and Grafana

## Problem Statement

**Current State:**
We are currently accessing Prometheus and Grafana UIs through port-forwarding methods:
```bash
kubectl port-forward svc/grafana -n grafana 3000:80
kubectl port-forward svc/prometheus-kube-prometheus-prometheus -n monitoring 9090:9090
```

**Business Requirement:**
We need to provide external access to Prometheus and Grafana services through our existing AWS Application Load Balancer, similar to how we currently access ArgoCD and other services. However, instead of using traditional Ingress resources, we want to implement this solution using the Kubernetes Gateway API with kgateway as the controller.

**Technical Requirements:**
- Utilize the existing ALB: `k8s-eksdevtestlb-1aee04181b-1372915356.us-west-2.elb.amazonaws.com`
- Implement Kubernetes Gateway API with kgateway controller (avoiding traditional Ingress approach)
- Configure hostname-based routing for:
  - Prometheus: `dev-prometheus.nirmata.co`
  - Grafana: `grafana-devtest.nirmata.co`
- Maintain security and observability standards

## Solution Architecture

```
Internet → ALB → kgateway Proxy → Kubernetes Services
```

### Traffic Flow:
1. **ALB** receives requests on port 80 (HTTP)
2. **ALB** routes to kgateway service based on hostname
3. **kgateway** processes Gateway API rules and routes to backend services
4. **Services** serve Prometheus (port 9090) and Grafana (port 80)

## Implementation Overview

### Core Components:
- **GatewayParameters**: Security and deployment configuration
- **Gateway**: HTTP listener on port 8080 with hostname-based routing
- **HTTPRoute**: Main application routing rules
- **DirectResponse**: Custom health check endpoints (`/healthz`)
- **Ingress**: ALB integration (required for AWS ALB controller)

### File Organization:
```
├── Prometheus/
│   ├── prometheus-gateway-params.yaml
│   ├── prometheus-gateway.yaml
│   ├── prometheus-httproute.yaml
│   ├── prometheus-healthcheck.yaml
│   └── prometheus-ingress.yaml
├── Grafana/
│   ├── grafana-gateway-params.yaml
│   ├── grafana-gateway.yaml
│   ├── grafana-httproute.yaml
│   ├── grafana-healthcheck.yaml
│   └── grafana-ingress.yaml
└── Testing.txt
```

## Key Configuration Details

### Security Configuration:
- **Kyverno Policy Compliance**: Configured seccomp profiles, non-root users, and disabled service account auto-mounting
- **Node Tolerations**: Support for jenkins, amd64, and addons dedicated nodes

### Health Checks:
- **DirectResponse**: Custom `/healthz` endpoints returning HTTP 200
- **Correct Pattern**: Using `filters` with `ExtensionRef` (not `backendRefs`)

### Hostname Routing:
- `dev-prometheus.nirmata.co` → Prometheus Gateway → prometheus-kube-prometheus-prometheus:9090
- `grafana-devtest.nirmata.co` → Grafana Gateway → grafana:80

## Major Issues & Solutions

### 1. **ARM64 Architecture Compatibility**
**Issue**: Gateway pods failing with "exec format error" on ARM64 nodes
**Solution**: Specified AMD64 preference in node affinity and added tolerations

### 2. **DirectResponse Configuration**
**Issue**: Initial attempts used DirectResponse in `backendRefs` (invalid)
**Solution**: Used DirectResponse in `filters` with `ExtensionRef` type (per official docs)

### 3. **Kyverno Security Policies**
**Issue**: Gateway pods blocked by security policies
**Solution**: Configured GatewayParameters with proper security contexts

## Limitations Discovered

### ❌ **Architecture Limitations:**
- **ARM64 Support**: Limited support for ARM64 nodes, requires AMD64 preference
- **Multi-arch Images**: Despite claiming multi-arch support, runtime issues on ARM64

### ❌ **AWS Integration:**
- **ALB Controller Limitation**: Requires Ingress resources (Gateway API not supported)
- **Mixed Approach**: Must use both Gateway API (kgateway) + Ingress (ALB)

### ❌ **DirectResponse Learning Curve:**
- **Documentation Gap**: Common misconception about using DirectResponse in backendRefs
- **Correct Usage**: Must use in filters with ExtensionRef type

## Current Status

### ✅ **Working Components:**
- **Prometheus**: Accessible via `http://dev-prometheus.nirmata.co`
- **Grafana**: Accessible via `http://grafana-devtest.nirmata.co` (redirects to /login)
- **Health Checks**: Custom `/healthz` endpoints working
- **ALB Integration**: Traffic routing through AWS ALB

### ⚠️ **Notes:**
- **HTTP Only**: Current setup uses HTTP (port 80), not HTTPS
- **Manual Deployment**: Files organized for easy deployment but requires manual application

## Deployment Commands

### Deploy Prometheus:
```bash
kubectl apply -f Prometheus/prometheus-gateway-params.yaml
kubectl apply -f Prometheus/prometheus-gateway.yaml
kubectl apply -f Prometheus/prometheus-httproute.yaml
kubectl apply -f Prometheus/prometheus-healthcheck.yaml
kubectl apply -f Prometheus/prometheus-ingress.yaml
```

### Deploy Grafana:
```bash
kubectl apply -f Grafana/grafana-gateway-params.yaml
kubectl apply -f Grafana/grafana-gateway.yaml
kubectl apply -f Grafana/grafana-httproute.yaml
kubectl apply -f Grafana/grafana-healthcheck.yaml
kubectl apply -f Grafana/grafana-ingress.yaml
```

### Quick Deploy All:
```bash
kubectl apply -f Prometheus/
kubectl apply -f Grafana/
```

## Testing

### Health Check Tests:
```bash
curl.exe -i k8s-eksdevtestlb-1aee04181b-1372915356.us-west-2.elb.amazonaws.com/healthz -H "Host: dev-prometheus.nirmata.co"
curl.exe -i k8s-eksdevtestlb-1aee04181b-1372915356.us-west-2.elb.amazonaws.com/healthz -H "Host: grafana-devtest.nirmata.co"
```

### Application Access:
```bash
curl.exe -i k8s-eksdevtestlb-1aee04181b-1372915356.us-west-2.elb.amazonaws.com/ -H "Host: dev-prometheus.nirmata.co"
curl.exe -i k8s-eksdevtestlb-1aee04181b-1372915356.us-west-2.elb.amazonaws.com/ -H "Host: grafana-devtest.nirmata.co"
```

## Lessons Learned

1. **Official Documentation is Key**: DirectResponse usage pattern found in [kgateway ALB docs](https://kgateway.dev/docs/setup/customize/aws-elb/alb/)
2. **ARM64 Considerations**: Test multi-arch support thoroughly in production-like environments
3. **Security First**: Kyverno policies enforced security best practices from the start
4. **Hybrid Approach**: Sometimes mixing APIs (Gateway API + Ingress) is necessary for cloud integration

---

**Result**: Successfully replaced port-forwarding with proper Gateway API routing while maintaining security and observability standards.
