'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async()=>{
  const worker = await import('../ops/cloudflare/nexus-publish-watchdog.mjs');
  const now = Date.parse('2026-11-20T00:40:00Z');
  const at = minutes => new Date(now - minutes*60000).toISOString();
  const env = {GITHUB_ACTIONS_TOKEN:'TEST_SECRET_NOT_REAL'};
  const mkResponse = (value, status=200) => ({ok:status>=200&&status<300,status,
    async json(){return value;}});
  function harness({
    snapshot={schema:'nexus-live-v2',generated_at:at(25)},
    history={workflow_runs:[]},
    pageStatus=200, historyStatus=200, dispatchStatus=204, pageThrows=false,
  }={}){
    const calls=[];
    async function fakeFetch(url, opts={}){
      calls.push({url,opts});
      if(url.startsWith(worker.SNAPSHOT_URL)){
        if(pageThrows)throw Error('Simulated public-site outage');
        return mkResponse(snapshot,pageStatus);
      }
      if(url===worker.PUBLISH_RUNS_URL) return mkResponse(history,historyStatus);
      if(url===worker.PUBLISH_DISPATCH_URL) return mkResponse(null,dispatchStatus);
      throw Error('Unexpected outbound URL');
    }
    return {calls,fakeFetch};
  }

  assert.equal(worker.snapshotIsRecent({schema:'nexus-live-v2',generated_at:at(0)},now),true);
  assert.equal(worker.snapshotIsRecent({schema:'nexus-live-v2',generated_at:at(12)},now),true);
  assert.equal(worker.snapshotIsRecent({schema:'nexus-live-v2',generated_at:at(12.5)},now),false);
  assert.equal(worker.snapshotIsRecent({schema:'nexus-live-v1',generated_at:at(1)},now),false);
  assert.equal(worker.snapshotIsRecent({schema:'nexus-live-v2',generated_at:'bad'},now),false);
  assert.equal(worker.snapshotIsRecent({schema:'nexus-live-v2',generated_at:at(-10)},now),false);
  assert.equal(worker.snapshotIsRecent(null,now),false);

  let h=harness({snapshot:{schema:'nexus-live-v2',generated_at:at(3)}});
  assert.equal(await worker.supervise(env,h.fakeFetch,now),'recent_public_snapshot');
  assert.equal(h.calls.length,1,'Never contact GitHub if snapshot already recent');
  assert.equal(h.calls[0].opts.cache,'no-store');
  assert.match(h.calls[0].url,/\?watchdog=/);

  h=harness();
  assert.equal(await worker.supervise(env,h.fakeFetch,now),'dispatch_requested');
  assert.equal(h.calls.length,3);
  assert.equal(h.calls[1].url,worker.PUBLISH_RUNS_URL);
  assert.equal(h.calls[2].url,worker.PUBLISH_DISPATCH_URL);
  assert.equal(h.calls[2].opts.method,'POST');
  assert.deepEqual(JSON.parse(h.calls[2].opts.body),{ref:'main'});
  assert.equal(h.calls[1].opts.headers.Authorization,'Bearer '+env.GITHUB_ACTIONS_TOKEN);
  assert.equal(h.calls[2].opts.headers.Authorization,'Bearer '+env.GITHUB_ACTIONS_TOKEN);
  assert.ok(h.calls.every(c=>!c.url.includes(env.GITHUB_ACTIONS_TOKEN)),
    'Never put token in URL, which may be logged');
  assert.ok(h.calls[0].url.startsWith('https://dotsthewarlock.github.io/nexus/data/live.json'));
  assert.ok(h.calls.slice(1).every(c=>c.url.startsWith('https://api.github.com/repos/dotsthewarlock/nexus/')));

  h=harness({dispatchStatus:200});
  assert.equal(await worker.supervise(env,h.fakeFetch,now),'dispatch_requested',
   'Newer GitHub API can return HTTP 200');

  for(const status of ['queued','in_progress','waiting','pending','requested']){
    h=harness({history:{workflow_runs:[{status,created_at:at(65)}]}});
    assert.equal(await worker.supervise(env,h.fakeFetch,now),'publisher_already_running_or_recent');
    assert.equal(h.calls.length,2,'Do not queue against in-flight publisher');
  }
  h=harness({history:{workflow_runs:[{status:'completed',created_at:at(3)}]}});
  assert.equal(await worker.supervise(env,h.fakeFetch,now),'publisher_already_running_or_recent');
  assert.equal(h.calls.length,2,'Prevent dispatch during Pages propagation window');

  h=harness({history:{workflow_runs:[{status:'completed',created_at:at(20)}]}});
  assert.equal(await worker.supervise(env,h.fakeFetch,now),'dispatch_requested',
    'Previous completed workflow does not suppress forever');

  h=harness({pageThrows:true});
  assert.equal(await worker.supervise(env,h.fakeFetch,now),'dispatch_requested',
    'Site unreachable should attempt collection recovery when GitHub idle');
  h=harness({pageStatus:503});
  assert.equal(await worker.supervise(env,h.fakeFetch,now),'dispatch_requested');
  h=harness({snapshot:{schema:'nexus-live-v2',generated_at:at(-10)}});
  assert.equal(await worker.supervise(env,h.fakeFetch,now),'dispatch_requested',
    'Implausibly future timestamp must not silence recovery');

  h=harness({historyStatus:403});
  await assert.rejects(worker.supervise(env,h.fakeFetch,now),/HTTP 403/);
  assert.equal(h.calls.length,2);
  h=harness({history:{bad:'payload'}});
  await assert.rejects(worker.supervise(env,h.fakeFetch,now),/history unavailable/);
  assert.equal(h.calls.length,2);
  h=harness({dispatchStatus:401});
  await assert.rejects(worker.supervise(env,h.fakeFetch,now),/HTTP 401/);
  assert.equal(h.calls.length,3);

  h=harness();
  await assert.rejects(worker.supervise({},h.fakeFetch,now),/secret is not configured/);
  assert.equal(h.calls.length,0,'Do not hit public or GitHub APIs without a configured secret');

  const response=await worker.default.fetch();
  assert.equal(response.status,404,'No public endpoint may trigger dispatch');
  assert.equal(await response.text(),'Not found');

  const publisher=fs.readFileSync('.github/workflows/publish.yml','utf8');
  assert.match(publisher,/workflow_dispatch:/,
   'Existing GitHub publisher already supports authenticated dispatch');
  assert.match(publisher,/concurrency:\s*\n\s*group: pages/,
   'Existing publisher serializes Pages deployments');
  const html=fs.readFileSync('index.html','utf8');
  assert.doesNotMatch(html,/nexus-publish-watchdog|GITHUB_ACTIONS_TOKEN/);
  assert.doesNotMatch(publisher,/GITHUB_ACTIONS_TOKEN/);
  const src=fs.readFileSync('ops/cloudflare/nexus-publish-watchdog.mjs','utf8');
  assert.doesNotMatch(src,/TEST_SECRET_NOT_REAL|navigator\.geolocation|process\.env/);
  console.log('M2c watchdog proposal tests passed: snapshot guard, Active Jobs, recovery, token isolation, no public trigger.');
})().catch(e=>{console.error(e);process.exitCode=1;});
