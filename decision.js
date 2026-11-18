/* Nexus RC1.4: deterministic, source-aware comparison logic. No DOM dependencies. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexusDecision = api;
})(typeof window === 'undefined' ? null : window, function() {
  'use strict';
  const IDS = ['tunnel', 'ambassador', 'gordie'];
  const NAMES = {tunnel:'Detroit–Windsor Tunnel', ambassador:'Ambassador Bridge', gordie:'Gordie Howe International Bridge'};
  // Explicit thresholds, provisional policy parameters; not statistical predictions.
  const MAX_SNAPSHOT_AGE = 150;
  const MAX_READING_AGE = 150;
  const AGING_AGE = 90;
  const MAX_OPERATOR_AGE = 60;
  const THRESHOLDS = {conservative:20, balanced:10};
  const age = (stamp, now) => {
    const value = Date.parse(stamp || '');
    return Number.isFinite(value) ? Math.max(0, (now - value) / 60000) : Infinity;
  };
  function reading(raw, snapshot, now) {
    if (!raw) return {kind:'unavailable', minutes:null, age:Infinity};
    const obsAge = age(raw.observation_at, now);
    const snapAge = age(snapshot?.generated_at, now);
    if (snapAge > MAX_SNAPSHOT_AGE) return {kind:'stale', minutes:null, age:obsAge};
    // Agency closed/N/A status is published as part of the fresh port record.
    // CBP often omits the lane's own observation time for 'Lanes Closed'.
    if (raw.status === 'closed') return {kind:'closed', minutes:null, age:obsAge};
    if (raw.status === 'not_applicable') return {kind:'not_applicable', minutes:null, age:obsAge};
    if (raw.status !== 'reported') return {kind:'unavailable', minutes:null, age:obsAge};
    if (obsAge > MAX_READING_AGE) return {kind:'stale', minutes:null, age:obsAge};
    if (!Number.isInteger(raw.minutes) || raw.minutes < 0)
      return {kind:'unavailable', minutes:null, age:obsAge};
    return {kind:obsAge > AGING_AGE ? 'aging' : 'current', minutes:raw.minutes, age:obsAge};
  }
  const usable = r => ['current','aging'].includes(r.kind);
  function crossing(data, direction, id, nexus, now) {
    const port = data?.directions?.[direction]?.[id] || {};
    const standard = reading(port.standard, data, now);
    const nx = reading(port.nexus, data, now);
    const ready = reading(port.ready, data, now);
    const commercial = reading(port.commercial, data, now);
    const fast = reading(port.fast, data, now);
    const pedestrian = reading(port.pedestrian, data, now);
    const portClosed = age(data?.generated_at, now) <= MAX_SNAPSHOT_AGE && /closed/i.test(port.port_status || '');
    const primary = nexus && direction === 'us' && usable(nx) ? nx : standard;
    const primaryType = nexus && direction === 'us' && usable(nx) ? 'nexus' : 'regular';
    const dwt = id === 'tunnel' ? data?.supplemental?.dwt?.[direction] : null;
    const operatorFresh = !!dwt && age(dwt.observation_at, now) <= MAX_OPERATOR_AGE && age(data?.generated_at, now) <= MAX_SNAPSHOT_AGE;
    return {id, name:NAMES[id], port, standard, nexus:nx, ready, commercial, fast, pedestrian, primary,
      primaryType, portClosed, dwt:operatorFresh ? dwt : null,
      dwtStale:!!dwt && !operatorFresh,
      nexusReportedClosed:nexus && direction === 'us' && nx.kind === 'closed',
      noUsNexusWait:direction === 'ca',
      isUsable:!portClosed && usable(primary)};
  }
  function publishedNexusWindow(data, id, direction, now) {
    if (direction !== 'ca' || data?.sources?.cbsa_hours?.status !== 'ok') return 'unknown';
    if (age(data.sources.cbsa_hours.retrieved_at, now) > 2880 || age(data.generated_at, now) > MAX_SNAPSHOT_AGE) return 'unknown';
    const groups=data?.supplemental?.cbsa_nexus_hours?.[id]?.groups;
    if (!Array.isArray(groups) || !groups.length) return 'unknown';
    const eastern=new Intl.DateTimeFormat('en-GB', {hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'America/Toronto'}).format(new Date(now));
    const parts=eastern.split(':').map(Number);
    if(parts.length!==2 || parts.some(x=>!Number.isInteger(x))) return 'unknown';
    const clock=parts[0]*60+parts[1];
    let considered=0;
    for(const group of groups)for(const row of (group.rows||[])){
      if (/24\s*h/i.test(String(row.custom||''))) return 'within_possible_window';
      const time=x=>{const m=/^(\d{2}):(\d{2})$/.exec(String(x||''));return m?Number(m[1])*60+Number(m[2]):null;};
      const start=time(row.start),end=time(row.end);
      if(start===null||end===null) continue;
      considered++;
      const effectiveEnd=end===0?1440:end;
      if (start<=effectiveEnd ? clock>=start&&clock<effectiveEnd : clock>=start||clock<effectiveEnd)
        return 'within_possible_window';
    }
    return considered>0 ? 'outside_all_published_windows':'unknown';
  }
  function evaluate(data, direction, preferred, nexus, mode='conservative', now=Date.now()) {
    const selectedPreferred = IDS.includes(preferred) ? preferred : 'tunnel';
    const crossings = IDS.map(id=>crossing(data, direction, id, nexus, now));
    const home = crossings.find(c=>c.id===selectedPreferred);
    const alternatives = crossings.filter(c=>c.id!==selectedPreferred);
    let headline='Conditions unavailable';
    let detail='Insufficient current inspection data to assess crossings.';
    let kind='unknown';
    let suggested=null;
    const clearOthers = alternatives.filter(a=>a.isUsable).sort((a,b)=>a.primary.minutes-b.primary.minutes);
    const nxSchedule=nexus?publishedNexusWindow(data,home.id,direction,now):'unknown';
    if (home.portClosed) {
      kind='closed'; headline=`${home.name} closed`;
      detail='Official port status reports a closure. Verify conditions before travelling.';
      if (clearOthers.length) {
        suggested=clearOthers[0].id;
        detail=`${clearOthers[0].name} has a recent inspection report. Check access and approach traffic.`;
      }
    } else if (!home.isUsable) {
      kind='unknown';
      headline=home.nexusReportedClosed ? 'NEXUS reported closed' : 'Conditions unavailable';
      detail=home.nexusReportedClosed ? 'Regular-lane data is unavailable. Review other crossings.' : 'Current inspection conditions cannot be verified. Compare available reports.';
    } else if (home.nexusReportedClosed) {
      kind='caution'; headline='NEXUS reported closed';
      detail='Regular-lane inspection wait is shown; alternative crossings may have NEXUS available.';
    } else if (nxSchedule==='outside_all_published_windows') {
      kind='caution'; headline='Outside published NEXUS hours';
      detail='CBSA schedule only; live NEXUS lane availability unverified. Regular wait is shown.';
    } else if (typeof home.port.notice === 'string' && home.port.notice.trim()) {
      kind='caution'; headline='Official crossing notice';
      detail=home.port.notice.trim().slice(0,250);
    } else {
      kind='normal'; headline='No significant disruptions reported';
      detail='Based on available inspection reports. Approach traffic is not fully verified.';
      if (mode !== 'information') {
        const threshold=THRESHOLDS[mode] ?? THRESHOLDS.conservative;
        // Only compare like-for-like source measurements. CA direction has only CBSA regular waits.
        const better=clearOthers.filter(a=>a.primaryType===home.primaryType &&
          home.primary.minutes-a.primary.minutes>=threshold);
        if (better.length) {
          better.sort((a,b)=>a.primary.minutes-b.primary.minutes);
          const best=better[0], gain=home.primary.minutes-best.primary.minutes;
          suggested=best.id; kind='consider';
          headline=`${best.name}: ${gain} min shorter inspection wait`;
          detail='Consider an alternative. Total-trip advantage is unverified.';
        }
      }
    }
    if (mode === 'information') suggested=null;
    return {kind, headline, detail, suggested, home, alternatives, crossings, direction, mode,
      nexusSchedule:nxSchedule, snapshotAge:age(data?.generated_at, now),
      sourceReady:!!data && age(data.generated_at, now)<=MAX_SNAPSHOT_AGE};
  }
  function countrySide(lat,lon, accuracyMeters=Infinity) {
    if (![lat,lon,accuracyMeters].every(Number.isFinite) || accuracyMeters>5000) return null;
    // Conservative inland geofences. Ambiguous waterfront and fringe coordinates
    // are intentionally unclassified rather than applying an inaccurate river line.
    if (lat>=42.18 && lat<=42.29 && lon>=-83.14 && lon<=-82.83) return 'ca';
    if (lat>=42.29 && lat<=42.325 && lon>=-83.025 && lon<=-82.83) return 'ca';
    if (lat>=42.39 && lat<=42.73 && lon>=-83.38 && lon<=-82.82) return 'us';
    if (lat>=42.32 && lat<=42.39 && lon>=-83.22 && lon<=-83.10) return 'us';
    if (lat>=42.345 && lat<=42.39 && lon>=-83.10 && lon<=-82.91) return 'us';
    return null;
  }
  return {IDS, NAMES, age, reading, usable, crossing, evaluate, publishedNexusWindow, countrySide, MAX_OPERATOR_AGE};
});
