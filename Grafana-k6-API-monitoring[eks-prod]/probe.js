// k6 API probe for Nirmata services
// Runs 1 virtual user for 1 minute (one round of requests every ~10s),
// so it measures performance without adding load.
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL;            // e.g. https://staging.nirmata.co
const TOKEN = __ENV.NIRMATA_API_TOKEN;      // from the k6-probe-secrets Secret

// Endpoints taken from the old production k6 script, plus the UI homepage.
// name -> becomes the "service" label in Prometheus / alerts
const ENDPOINTS = [
  { name: 'webclient',    path: '/security/login.html',                       auth: false },
  { name: 'environments', path: '/environments/api/Environment',              auth: true },
  { name: 'application',  path: '/environments/api/Application',              auth: true },
  { name: 'cluster',      path: '/cluster/api/KubernetesCluster',             auth: true },
  { name: 'clustertype',  path: '/cluster/api/ClusterType',                   auth: true },
  { name: 'policies',     path: '/policies/api/getPolicyReportCategoryTable', auth: true },
  { name: 'catalog',      path: '/catalog/api/Catalogs',                      auth: true },
  { name: 'users',        path: '/users/api/Users',                           auth: true },
];

export const options = {
  vus: 1,
  duration: '1m',
  discardResponseBodies: true,   // only status and timing matter; saves memory and bandwidth
};

export default function () {
  for (const ep of ENDPOINTS) {
    const headers = { Accept: 'application/json' };
    if (ep.auth) headers.Authorization = `NIRMATA-API ${TOKEN}`;
    const res = http.get(`${BASE_URL}${ep.path}`, {
      headers,
      tags: { service: ep.name },
      timeout: '30s',
    });
    check(res, { [`${ep.name} returns 200`]: (r) => r.status === 200 }, { service: ep.name });
    if (res.status !== 200) {
      // log only status and timing (never headers, which contain the API key)
      console.warn(`${ep.name} returned ${res.status} after ${Math.round(res.timings.duration)} ms ${res.error || ''}`);
    }
  }
  sleep(10);
}
