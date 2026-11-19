/* Nexus RC1.4.6: conservative, timestamp-aware inspection comparisons. No DOM dependencies. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexusDecision = api;
})(typeof window === 'undefined' ? null : window, function() {
  'use strict';
  const IDS = ['tunnel', 'ambassador', 'gordie'];
  const NAMES = {tunnel:'Detroit–Windsor Tunnel', ambassador:'Ambassador Bridge', gordie:'Gordie Howe International Bridge'};
  // These are Nexus's cautious policy thresholds, NOT agency update SLAs.
  const CLOCK_SKEW_MIN = 2;
  const READING_CURRENT_AGE = 10;
  const READING_AGING_AGE = 20;
  const READING_EXPIRE_AGE = 60;
  const SNAPSHOT_RECENT_AGE = 20;
  const RECOMMEND_MAX_AGE = 10;
  const RECOMMEND_MAX_OBSERVATION_GAP = 5;
  const MAX_OPERATOR_AGE = 20;
  const THRESHOLDS = {conservative:20, balanced:10};
  function age(stamp, now=Date.now()) {
    const parsed = typeof stamp === 'string' && stamp.trim() ? Date.parse(stamp) : NaN;
    if (!Number.isFinite(parsed)) return Infinity;
    const minutes=(now-parsed)/60000;
    // Small positive clock differences are tolerated; implausible future data isn't.
    return minutes < -CLOCK_SKEW_MIN ? Infinity : Math.max(0,minutes);
  }
  function reading(raw, snapshot, now=Date.now()) {
    if (!raw) return {kind:'unavailable',minutes:null,age:Infinity};
    const obsAge=age(raw.observation_at,now),snapAge=age(snapshot?.generated_at,now);
    const snapshotRecent=snapAge<=SNAPSHOT_RECENT_AGE;
    // CBP can mark a lane closed without a lane-specific observation timestamp.
    // Such status is credible only if the actual CBP snapshot is recent.
    if (raw.status === 'closed' || raw.status === 'not_applicable')
      return snapshotRecent ? {kind:raw.status,minutes:null,age:obsAge} : {kind:'unavailable',minutes:null,age:obsAge};
    if (raw.status !== 'reported' || !Number.isInteger(raw.minutes) || raw.minutes<0 || raw.minutes>720)
      return {kind:'unavailable',minutes:null,age:obsAge};
    if (!Number.isFinite(obsAge) || !Number.isFinite(snapAge) || obsAge>READING_EXPIRE_AGE || snapAge>READING_EXPIRE_AGE)
      return {kind:'unavailable',minutes:null,age:obsAge};
    // Show old numeric readings only with an explicit stale label, never as decision evidence.
    if (!snapshotRecent || obsAge>READING_AGING_AGE)
      return {kind:'stale',minutes:raw.minutes,age:obsAge};
    return {kind:obsAge<=READING_CURRENT_AGE?'current':'aging',minutes:raw.minutes,age:obsAge};
  }
  const usable = r => !!r && (r.kind==='current'||r.kind==='aging');
  const recommendationReady = r => !!r && r.kind==='current' && r.age<=RECOMMEND_MAX_AGE;
  function noticeKind(notice) {
    if (typeof notice!=='string' || !notice.trim()) return 'none';
    const n=notice.replace(/\s+/g,' ').trim().toLowerCase();
    // A published Ready Lane timetable is not a disruption to passenger crossings.
    if (/\bready lane\b/.test(n) && /\b(available|hours|schedule|from\s+\d)/.test(n) &&
        !/\b(incident|emergency|construction|detour|suspended|closed|closure|blocked|restricted|unavailable)\b|not\s+available/.test(n)) return 'informational';
    if (/\b(closed|closure|suspended|blocked|detour|incident|construction|restricted|lane reduction|reduced lanes)\b/.test(n)) return 'operational';
    return 'informational';
  }
  function crossing(data,direction,id,nexus,now=Date.now()) {
    const port=data?.directions?.[direction]?.[id]||{};
    const source=data?.sources?.[direction==='us'?'cbp':'cbsa'];
    const sourceRecent=source?.status==='ok' && age(source.retrieved_at,now)<=SNAPSHOT_RECENT_AGE;
    const sourceReading=raw=>{
      const r=reading(raw,data,now);
      // A recently generated wrapper cannot validate an older or failed source.
      if(source?.status!=='ok' || !Number.isFinite(age(source?.retrieved_at,now)))
        return {kind:'unavailable',minutes:null,age:r.age};
      if(!sourceRecent && (usable(r)||r.kind==='closed'||r.kind==='not_applicable'))
        return Number.isInteger(r.minutes)?{kind:'stale',minutes:r.minutes,age:r.age}:{kind:'unavailable',minutes:null,age:r.age};
      return r;
    };
    const standard=sourceReading(port.standard);
    const nx=sourceReading(port.nexus);
    const ready=sourceReading(port.ready);
    const commercial=sourceReading(port.commercial);
    const fast=sourceReading(port.fast);
    const pedestrian=sourceReading(port.pedestrian);
    const portClosed=sourceRecent && age(data?.generated_at,now)<=SNAPSHOT_RECENT_AGE &&
      /^\s*(temporarily\s+)?closed\b/i.test(port.port_status||'');
    const primary=nexus && direction==='us' && usable(nx)?nx:standard;
    const primaryType=nexus && direction==='us' && usable(nx)?'nexus':'regular';
    const dwt=id==='tunnel'?data?.supplemental?.dwt?.[direction]:null;
    const operatorFresh=!!dwt && age(dwt.observation_at,now)<=MAX_OPERATOR_AGE &&
      age(data?.generated_at,now)<=SNAPSHOT_RECENT_AGE;
    return {id,name:NAMES[id],port,standard,nexus:nx,ready,commercial,fast,pedestrian,primary,primaryType,portClosed,
      sourceRecent,noticeKind:noticeKind(port.notice),dwt:operatorFresh?dwt:null,dwtStale:!!dwt&&!operatorFresh,
      nexusReportedClosed:nexus&&direction==='us'&&nx.kind==='closed',noUsNexusWait:direction==='ca',
      isUsable:!portClosed&&sourceRecent&&usable(primary)};
  }
  // Calendar dates from official Canada.ca public holiday dates and Ontario school calendars.
  // CBSA has NOT defined which jurisdiction's observed holiday it uses for each lane;
  // therefore uncertain observed weekdays are reported as unknown, never 'open/closed'.
  const HOLIDAYS={
    '2026':new Set(['01-01','02-16','04-03','04-06','05-18','07-01','08-03','09-07','09-30','10-12','11-11','12-25','12-26']),
    '2027':new Set(['01-01','02-15','03-26','03-29','05-24','07-01','08-02','09-06','09-30','10-11','11-11','12-25','12-26'])
  };
  const UNCERTAIN_OBSERVED=new Set(['2026-12-28','2027-12-27','2027-12-28']);
  function localDay(now) {
    const date=new Date(now);
    if (!Number.isFinite(date.getTime())) return null;
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
    const f=key=>parts.find(p=>p.type===key)?.value;
    const year=f('year'),month=f('month'),day=f('day'),weekday=f('weekday'),hour=Number(f('hour')),minute=Number(f('minute'));
    if(!year||!month||!day||!weekday||!Number.isFinite(hour)||!Number.isFinite(minute))return null;
    return {year,month,day,weekday,clock:hour*60+minute};
  }
  function dayKind(parts) {
    if(!parts)return 'unknown';
    if(['Sat','Sun'].includes(parts.weekday)) return 'weekend';
    const iso=`${parts.year}-${parts.month}-${parts.day}`;
    if(UNCERTAIN_OBSERVED.has(iso))return 'unknown';
    if(!HOLIDAYS[parts.year])return 'unknown';
    return HOLIDAYS[parts.year].has(`${parts.month}-${parts.day}`)?'holiday':'weekday';
  }
  function rowApplies(label,kind) {
    const s=String(label||'').toLowerCase().replace(/\s+/g,' ');
    if(/7\s*days|every\s*day|daily|all\s*days/.test(s))return true;
    const weekend=/weekend|saturday|sunday|sat\b|sun\b/.test(s);
    const weekday=/weekday|monday\s*(?:to|through|-)\s*friday|mon\s*(?:to|-)\s*fri/.test(s);
    const holiday=/holiday/.test(s);
    if (!weekend&&!weekday&&!holiday)return null;
    if(kind==='unknown')return null;
    if(kind==='holiday')return holiday && !(/except\s+holiday/.test(s));
    if(kind==='weekend')return weekend;
    return weekday;
  }
  const toMinutes=x=>{const m=/^(\d{1,2}):(\d{2})$/.exec(String(x||''));return m&&Number(m[1])<=24&&Number(m[2])<60?Number(m[1])*60+Number(m[2]):null;};
  function publishedNexusWindow(data,id,direction,now=Date.now()) {
    if(direction!=='ca'||data?.sources?.cbsa_hours?.status!=='ok')return 'unknown';
    if(age(data.sources.cbsa_hours.retrieved_at,now)>2880||age(data.generated_at,now)>SNAPSHOT_RECENT_AGE)return 'unknown';
    const groups=data?.supplemental?.cbsa_nexus_hours?.[id]?.groups;
    if(!Array.isArray(groups)||!groups.length)return 'unknown';
    const local=localDay(now);if(!local)return 'unknown';
    const today=dayKind(local);
    // Previous local day for a true overnight schedule, with DST handled by Intl.
    const previous=dayKind(localDay(now-24*60*60000));
    let hasEvaluated=false,uncertain=false;
    for(const group of groups)for(const row of (group.rows||[])) {
      const label=row.label||group.label||'';
      const hours=String(row.custom||'');
      if(/24\s*h|24\s*hours/i.test(hours)) {
        const applies=rowApplies(label,today);
        if(applies===true)return 'within_possible_window';
        if(applies===null)uncertain=true;
        if(applies===false)hasEvaluated=true;
        continue;
      }
      const start=toMinutes(row.start),end=toMinutes(row.end);
      if(start===null||end===null){uncertain=true;continue;}
      const effectiveEnd=end===0?1440:end;
      const overnight=start>effectiveEnd;
      const todayWindow=overnight?local.clock>=start:local.clock>=start&&local.clock<effectiveEnd;
      const previousWindow=overnight&&local.clock<effectiveEnd;
      const todayApplies=rowApplies(label,today);
      const previousApplies=rowApplies(label,previous);
      if(todayWindow&&todayApplies===true || previousWindow&&previousApplies===true)return 'within_possible_window';
      if(todayWindow&&todayApplies===null || previousWindow&&previousApplies===null)uncertain=true;
      if(todayApplies===null || overnight&&previousApplies===null)uncertain=true;
      if(todayApplies!==null)hasEvaluated=true;
    }
    return !uncertain&&hasEvaluated?'outside_all_published_windows':'unknown';
  }
  function evaluate(data,direction,preferred,nexus,mode='conservative',now=Date.now()) {
    const id=IDS.includes(preferred)?preferred:'tunnel';
    const crossings=IDS.map(k=>crossing(data,direction,k,nexus,now));
    const home=crossings.find(c=>c.id===id);
    const alternatives=crossings.filter(c=>c.id!==id);
    let kind='unknown',headline='Conditions unavailable',detail='Current inspection conditions cannot be verified.',suggested=null;
    const nxSchedule=nexus?publishedNexusWindow(data,home.id,direction,now):'unknown';
    const source=data?.sources?.[direction==='us'?'cbp':'cbsa'];
    const sourceAge=age(source?.retrieved_at,now);
    const snapshotAge=age(data?.generated_at,now);
    const canCompare=source?.status==='ok'&&sourceAge<=RECOMMEND_MAX_AGE&&snapshotAge<=RECOMMEND_MAX_AGE;
    const eligibleOthers=alternatives.filter(a=>a.isUsable&&a.noticeKind!=='operational'&&recommendationReady(a.primary));
    if(home.portClosed) {
      kind='closed';headline=`${home.name} reported closed`;
      detail='Official port status reports a closure; confirm access before travelling.';
      if(canCompare&&mode!=='information'&&eligibleOthers.length) {
        const best=eligibleOthers.sort((a,b)=>a.primary.minutes-b.primary.minutes)[0];
        suggested=best.id;detail=`${best.name} has a recent inspection report. Approach traffic remains unverified.`;
      }
    } else if(!home.isUsable) {
      kind='unknown';headline=home.nexusReportedClosed?'NEXUS reported closed':'Current conditions unavailable';
      detail=home.nexusReportedClosed?'Regular-lane data unavailable; verify alternatives.':
        'Source data is missing, stale, or has an unverified timestamp. Older readings may appear labeled below.';
    } else if(home.nexusReportedClosed) {
      kind='caution';headline='NEXUS reported closed';
      detail='Regular inspection wait shown; availability at other crossings requires verification.';
    } else if(nexus&&direction==='us'&&!usable(home.nexus)) {
      kind='unknown';headline='NEXUS conditions unverified';
      detail='Regular-lane wait shown for context. No NEXUS-based crossing recommendation is possible.';
    } else if(nxSchedule==='outside_all_published_windows') {
      kind='caution';headline='Outside published NEXUS hours';
      detail='Schedule only; actual lane availability is not independently verified.';
    } else if(home.noticeKind==='operational') {
      kind='caution';headline='Official crossing advisory';
      detail=String(home.port.notice).trim().slice(0,250);
    } else {
      const comparisonIncomplete=!canCompare || !recommendationReady(home.primary) ||
        alternatives.some(a=>!a.isUsable||!recommendationReady(a.primary)||a.primaryType!==home.primaryType||a.noticeKind==='operational');
      kind=comparisonIncomplete?'caution':'normal';
      headline=comparisonIncomplete?'Inspection comparison incomplete':'No significant crossing disruptions reported';
      detail=comparisonIncomplete?'One or more inspection observations are aging, unavailable, or not comparable. No unsupported conclusion is inferred.':
        'Based on available inspection records; approach-road conditions are not fully verified.';
      if(mode!=='information'&&canCompare&&recommendationReady(home.primary)) {
        const threshold=THRESHOLDS[mode]??THRESHOLDS.conservative;
        const better=eligibleOthers.filter(a=>a.primaryType===home.primaryType&&
          Math.abs(home.primary.age-a.primary.age)<=RECOMMEND_MAX_OBSERVATION_GAP&&
          home.primary.minutes-a.primary.minutes>=threshold);
        if(better.length) {
          better.sort((a,b)=>a.primary.minutes-b.primary.minutes);
          const best=better[0],gain=home.primary.minutes-best.primary.minutes;
          suggested=best.id;kind='consider';
          headline=`${best.name}: ${gain} min shorter inspection wait`;
          detail='Comparable inspection reports support considering this option. Full-trip advantage unverified.';
        }
      }
    }
    if(mode==='information')suggested=null;
    return {kind,headline,detail,suggested,home,alternatives,crossings,direction,mode,nexusSchedule:nxSchedule,
      snapshotAge,sourceReady:source?.status==='ok'&&snapshotAge<=SNAPSHOT_RECENT_AGE&&sourceAge<=SNAPSHOT_RECENT_AGE,
      comparisonReady:canCompare};
  }
  function countrySide(lat,lon,accuracyMeters=Infinity) {
    if(![lat,lon,accuracyMeters].every(Number.isFinite)||accuracyMeters>5000)return null;
    if(lat>=42.18&&lat<=42.29&&lon>=-83.14&&lon<=-82.83)return 'ca';
    if(lat>=42.29&&lat<=42.325&&lon>=-83.025&&lon<=-82.83)return 'ca';
    if(lat>=42.39&&lat<=42.73&&lon>=-83.38&&lon<=-82.82)return 'us';
    if(lat>=42.32&&lat<=42.39&&lon>=-83.22&&lon<=-83.10)return 'us';
    if(lat>=42.345&&lat<=42.39&&lon>=-83.10&&lon<=-82.91)return 'us';
    return null;
  }
  return {IDS,NAMES,age,reading,usable,recommendationReady,noticeKind,crossing,evaluate,publishedNexusWindow,
    countrySide,MAX_OPERATOR_AGE,READING_CURRENT_AGE,READING_AGING_AGE,READING_EXPIRE_AGE,SNAPSHOT_RECENT_AGE,
    RECOMMEND_MAX_AGE,RECOMMEND_MAX_OBSERVATION_GAP};
});
