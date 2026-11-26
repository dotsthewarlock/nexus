/* Nexus RC1.4.8: evidence-aware inspection displays and conservative comparisons. */
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
  const READING_STALE_AGE = 60;
  const READING_EXPIRE_AGE = 120; // Values older than 2h must not appear as present waits.
  const SNAPSHOT_RECENT_AGE = 20;
  const RECOMMEND_MAX_AGE = 10;
  const RECOMMEND_MAX_OBSERVATION_GAP = 5;
  const MAX_OPERATOR_AGE = 20;
  const THRESHOLDS = {conservative:20, balanced:10};
  function age(stamp, now=Date.now()) {
    // Require an explicit UTC/offset suffix. Browser-local interpretation of
    // timestamp strings without a zone would corrupt freshness at DST changes.
    const value = typeof stamp === 'string' ? stamp.trim() : '';
    const dated = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
    // Date.parse can silently normalize an impossible day (e.g. February 30).
    if(dated){
      const [year,month,day]=value.slice(0,10).split('-').map(Number);
      const calendar=new Date(0);calendar.setUTCFullYear(year,month-1,day);
      if(calendar.getUTCFullYear()!==year||calendar.getUTCMonth()!==month-1||calendar.getUTCDate()!==day||
         Number(value.slice(11,13))>23)return Infinity;
    }
    const parsed = dated ? Date.parse(value) : NaN;
    if (!Number.isFinite(parsed)) return Infinity;
    const minutes=(now-parsed)/60000;
    // Small positive clock differences are tolerated; implausible future data isn't.
    return minutes < -CLOCK_SKEW_MIN ? Infinity : Math.max(0,minutes);
  }

  // Owner-selected interpretation: DWT NexusLaneCount reports open NEXUS
  // lanes Detroit -> Windsor. This is not an inspection wait or additive total.
  // Every clock is independent: a fresh HTTP request cannot renew old data.
  function dwtNexusLane(data,id,direction,vehicle,lane,now=Date.now()) {
    const record=data?.supplemental?.dwt?.ca,src=data?.sources?.dwt;
    const base={kind:'unavailable',count:null,source:'DWT',
      observationAt:record?.observation_at??null,
      retrievedAt:src?.retrieved_at??null,snapshotAt:data?.generated_at??null,
      reason:'No verified recent operator lane report.'};
    if(id!=='tunnel'||direction!=='ca'||vehicle!=='passenger'||lane!=='nexus')
      return {...base,reason:'DWT Canada-bound NEXUS count does not apply to this selection.'};
    if(!record||!src)return base;
    if(record.source!=null&&record.source!=='DWT')return {...base,kind:'invalid',reason:'Operator source identity does not match DWT.'};
    const count=record.lane_counts?.nexus;
    if(!Number.isInteger(count)||count<0||count>20)
      return {...base,kind:'invalid',reason:'Operator lane count missing or invalid.'};
    // Require an explicit timezone to avoid browser-local DST interpretation.
    const dated=s=>typeof s==='string'&&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(s)&&
      Number.isFinite(Date.parse(s));
    if(![record.observation_at,src.retrieved_at,data?.generated_at].every(dated))
      return {...base,kind:'invalid',reason:'Missing or ambiguous observation, retrieval or publication timestamp.'};
    const fresh=src.status==='ok'&&!src.retained_previous&&
      age(record.observation_at,now)<=MAX_OPERATOR_AGE&&
      age(src.retrieved_at,now)<=MAX_OPERATOR_AGE&&
      age(src.last_success_at??src.retrieved_at,now)<=MAX_OPERATOR_AGE&&
      age(data.generated_at,now)<=SNAPSHOT_RECENT_AGE;
    if(!fresh)return {...base,kind:'stale',
      reason:'Operator report or its retrieval/publication is old or unavailable.'};
    return {...base,kind:count===0?'reported_zero':'current',count,
      reason:'Recent DWT operator-reported open NEXUS lane count; not inspection wait minutes.'};
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
    // A snapshot may be recent even when the agency's observation is hours old.
    // Both clocks control display; neither refreshes or upgrades the other.
    if (obsAge>READING_STALE_AGE || snapAge>READING_STALE_AGE)
      return {kind:'old',minutes:raw.minutes,age:obsAge};
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
    const retrievedAge=age(source?.retrieved_at,now);
    const sourceRecent=source?.status==='ok' && retrievedAge<=SNAPSHOT_RECENT_AGE;
    const historicalFallback=source?.status==='error' && source?.retained_previous===true &&
      age(source?.last_success_at,now)<=READING_EXPIRE_AGE;
    const sourceReading=raw=>{
      const r=reading(raw,data,now);
      // Failed sources may display explicitly OLD, provenance-preserved values.
      // Never interpret old lane closures or operator notices as live status.
      if(historicalFallback)
        return Number.isInteger(r.minutes) && r.kind!=='unavailable'
          ? {kind:'old',minutes:r.minutes,age:r.age} : {kind:'unavailable',minutes:null,age:r.age};
      if(source?.status!=='ok' || !Number.isFinite(retrievedAge))
        return {kind:'unavailable',minutes:null,age:r.age};
      if(!sourceRecent && (usable(r)||r.kind==='closed'||r.kind==='not_applicable'))
        return Number.isInteger(r.minutes)
          ? {kind:retrievedAge>READING_STALE_AGE?'old':'stale',minutes:r.minutes,age:r.age}
          : {kind:'unavailable',minutes:null,age:r.age};
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
    const dwtSource=data?.sources?.dwt;
    const operatorFresh=!!dwt && dwtSource?.status==='ok' && !dwtSource.retained_previous &&
      age(dwt.observation_at,now)<=MAX_OPERATOR_AGE &&
      age(dwtSource.retrieved_at,now)<=MAX_OPERATOR_AGE &&
      age(data?.generated_at,now)<=SNAPSHOT_RECENT_AGE;
    return {id,name:NAMES[id],port,standard,nexus:nx,ready,commercial,fast,pedestrian,primary,primaryType,portClosed,
      sourceRecent,sourceFailed:source?.status==='error',noticeKind:noticeKind(port.notice),dwt:operatorFresh?dwt:null,dwtStale:!!dwt&&!operatorFresh,
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
  // Published CBSA Canada-bound NEXUS access schedule; not a live lane status.
  // Merge overlapping daily windows so earlier partial lane closures do not
  // misleadingly imply all NEXUS access ends at that time.
  function nextNexusSchedule(data,id,direction,now=Date.now()) {
    const unknown=reason=>({kind:'unknown',reason,next:null,source:'CBSA'});
    if(direction!=='ca')return unknown('No verified US-bound NEXUS schedule in current sources');
    const source=data?.sources?.cbsa_hours;
    if(source?.status!=='ok'||age(source.retrieved_at,now)>2880||
      age(data?.generated_at,now)>SNAPSHOT_RECENT_AGE)
      return unknown('Published CBSA schedule is missing or outdated');
    const groups=data?.supplemental?.cbsa_nexus_hours?.[id]?.groups;
    if(!Array.isArray(groups)||!groups.length)return unknown('No CBSA NEXUS schedule for this crossing');
    const local=localDay(now);
    if(!local)return unknown('Local date unavailable');
    const y=Number(local.year),m=Number(local.month)-1,d=Number(local.day);
    const intervals=[],uncertainDays=new Set();
    let hasSchedule=false;
    for(let offset=-1;offset<=8;offset++) {
      const civil=Date.UTC(y,m,d+offset,17,0);
      const kind=dayKind(localDay(civil));
      for(const group of groups)for(const row of (group.rows||[])) {
        const label=row.label||group.label||'';
        const applies=rowApplies(label,kind);
        if(applies===null) { uncertainDays.add(offset);continue; }
        if(!applies)continue;
        let start,end;
        if(/24\s*h(?:ours?|rs?)?\b/i.test(String(row.custom||''))){start=0;end=1440;}
        else {
          start=toMinutes(row.start);end=toMinutes(row.end);
          if(start===null||end===null||start>=1440||end>1440){
            uncertainDays.add(offset);continue;
          }
          if(end===0)end=1440;
          if(end<=start)end+=1440;
        }
        hasSchedule=true;
        intervals.push({start:offset*1440+start,end:offset*1440+end});
      }
    }
    if(!hasSchedule)return unknown('Published CBSA hours cannot be interpreted');
    intervals.sort((a,b)=>a.start-b.start||a.end-b.end);
    const merged=[];
    for(const w of intervals){
      const last=merged[merged.length-1];
      if(last&&last.end>=w.start)last.end=Math.max(last.end,w.end);
      else merged.push({...w});
    }
    const minute=local.clock;
    const present=merged.find(w=>w.start<=minute&&minute<w.end);
    const candidate=present
      ? {kind:'within',event:'closes',at:present.end}
      : {kind:'outside',event:'opens',at:merged.find(w=>w.start>minute)?.start??null};
    if(candidate.at===null||candidate.at>8*1440)
      return {kind:candidate.kind,next:null,reason:'No next schedule change established within the published window',source:'CBSA'};
    // Do not assert next change if an ambiguous schedule row could change the
    // interval before that point (notably holidays/unsupported day labels).
    for(let day=0;day<=Math.floor(candidate.at/1440);day++){
      if(uncertainDays.has(day))return unknown('Published hours have ambiguous day or holiday rules');
    }
    const dayOffset=Math.floor(candidate.at/1440);
    const minuteOfDay=((candidate.at%1440)+1440)%1440;
    const civil=Date.UTC(y,m,d+dayOffset,12,0);
    const clockText=new Intl.DateTimeFormat('en-CA',{hour:'numeric',minute:'2-digit',
      hour12:true,timeZone:'UTC'}).format(new Date(Date.UTC(2026,0,1,
        Math.floor(minuteOfDay/60),minuteOfDay%60)));
    const dateText=dayOffset===0?'Today':dayOffset===1?'Tomorrow':
      new Intl.DateTimeFormat('en-CA',{weekday:'short',month:'short',day:'numeric',
        timeZone:'UTC'}).format(new Date(civil));
    return {kind:candidate.kind,event:candidate.event,next:dateText+' '+clockText+' ET',
      reason:null,source:'CBSA'};
  }
  // Only Ambassador publishes individually named Canada-bound NEXUS lane
  // timetables. Count distinct explicitly named lanes within the published
  // time window; this is NOT the number of lanes confirmed open.
  function scheduledNexusLaneCount(data,id,direction,now=Date.now()) {
    if(id!=='ambassador'||direction!=='ca')return null;
    if(nextNexusSchedule(data,id,direction,now).kind!=='within')return null;
    const groups=data?.supplemental?.cbsa_nexus_hours?.[id]?.groups;
    const local=localDay(now),kind=dayKind(local);
    if(!Array.isArray(groups)||!groups.length||kind==='unknown')return null;
    const active=new Set();
    const names={one:'1',two:'2',three:'3','1':'1','2':'2','3':'3'};
    for(const group of groups){
      for(const row of group.rows||[]){
        const label=String(row.label||'');
        const lane=/^\s*lane\s+(one|two|three|[1-3])\b/i.exec(label);
        // An unenumerated or unrecognized timetable cannot be converted
        // into a total count, even when one named lane is scheduled.
        if(!lane)return null;
        const applies=rowApplies(label,kind);
        if(applies===null)return null;
        if(!applies)continue;
        const start=toMinutes(row.start),rawEnd=toMinutes(row.end);
        if(start===null||rawEnd===null||start>=1440||rawEnd>1440)return null;
        const end=rawEnd===0?1440:rawEnd;
        if(end<=start)return null; // Unsupported overnight lane count.
        if(local.clock>=start&&local.clock<end)active.add(names[lane[1].toLowerCase()]);
      }
    }
    return active.size||null;
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

  // R2 presentation contract (v0.8). No collection, schema or route policy changes.
  // The normalized schema supplies no independently dated port status. It is a
  // safety caution, not a confirmed current closure. Do not borrow a lane timestamp.
  const VALID_CATEGORIES={passenger:['regular','nexus','ready'],commercial:['regular','fast']};
  const laneField=(vehicle,category)=>category==='regular'?(vehicle==='passenger'?'standard':'commercial'):category;
  const countValid=n=>Number.isInteger(n)&&n>=0&&n<=100;
  function sourceClocks(data,dir,now){
    const src=data?.sources?.[dir==='ca'?'cbsa':'cbp'];
    const retained=src?.retained_previous===true;
    const retrievalAge=age(src?.retrieved_at,now);
    const successStamp=src?.last_success_at??(!retained&&src?.status==='ok'?src.retrieved_at:null);
    const successAge=age(successStamp,now),publicationAge=age(data?.generated_at,now);
    const valid=(src?.status==='ok'||(src?.status==='error'&&retained))&&
      [retrievalAge,successAge,publicationAge].every(Number.isFinite);
    const current=valid&&src.status==='ok'&&!retained&&
      Math.max(retrievalAge,successAge,publicationAge)<=20;
    const historical=valid&&Math.max(retrievalAge,successAge,publicationAge)<120;
    return {src,retained,retrievalAge,successAge,publicationAge,successStamp,current,historical};
  }
  function classifyReading(data,port,dir,vehicle,category,now=Date.now()){
    const field=laneField(vehicle,category),raw=port?.[field],c=sourceClocks(data,dir,now);
    const observationAge=age(raw?.observation_at,now);
    const base={kind:'unavailable',state:'missing',text:'--',minutes:null,count:null,sortEligible:false,
      source:dir==='ca'?'CBSA':'CBP',direction:dir,vehicle,category,field,raw,src:c.src,
      observationAt:raw?.observation_at??null,retrievedAt:c.src?.retrieved_at??null,
      lastSuccessAt:c.successStamp??null,publishedAt:data?.generated_at??null,
      ages:{observation:observationAge,retrieval:c.retrievalAge,lastSuccess:c.successAge,publication:c.publicationAge}};
    const out=(state,reason,extra={})=>({...base,state,reason,...extra});
    if(!['ca','us'].includes(dir)||!VALID_CATEGORIES[vehicle]?.includes(category))
      return out('invalid','Invalid vehicle/category/direction.');
    if((port?.source!=null&&port.source!==base.source)||(raw?.source!=null&&raw.source!==base.source))
      return out('invalid','Official report source does not match the selected direction.');
    if(/^\s*(temporarily\s+)?closed\b/i.test(port?.port_status||''))
      return out('port_closure_unverified','Official source reports this direction closed; status currency unverified. Verify before travel.',
        {kind:'closure_unverified',text:'Closure unverified',closureScope:'port'});
    if(dir==='ca'&&['nexus','ready','fast'].includes(category))
      return out('unpublished','CBSA does not publish a separate Canada-bound wait for this category.',
        {kind:category==='nexus'?'unpublished':'unavailable'});
    if(raw?.status==='closed'){
      if(c.current&&observationAge<=20)
        return out('category_closure','Recent source-reported category closure; verify before travel.',
          {kind:'closed',text:'Closed',closureScope:'category'});
      return out('category_closure_unverified','Earlier or undated source-reported category closure; current operation unverified.',
        {kind:'closure_unverified',text:'Closure unverified',closureScope:'category'});
    }
    if(!raw)return out('missing','No category-specific official wait is published for this crossing and direction.');
    if(!c.historical)return out(c.src?.status==='ok'&&[c.retrievalAge,c.successAge,c.publicationAge].every(Number.isFinite)?'expired':'source_unavailable',
      'The official source or its successful retrieval/publication is unavailable or expired.');
    if(raw.status==='not_applicable')
      return c.current&&(!raw.observation_at||observationAge<=20)
        ?out('agency_na','Agency field N/A; physical lane eligibility is not independently verified.',{kind:'unsupported',text:'N/A'})
        :out('agency_na_historical','Earlier agency N/A; current applicability unverified.');
    if(raw.status!=='reported'||!Number.isInteger(raw.minutes)||raw.minutes<0||raw.minutes>720||!Number.isFinite(observationAge))
      return out('invalid','No valid timestamped wait for this category.');
    if(observationAge>=120)return out('expired','Historical inspection wait has expired.');
    if(!c.current||observationAge>20)
      return out('historical','Historical report, not a current wait.',{kind:'stale',minutes:raw.minutes,text:raw.minutes+' min'});
    return out('current','Recent official inspection report; not a full-trip ETA.',
      {kind:'current',minutes:raw.minutes,text:raw.minutes+' min',sortEligible:true,
        count:dir==='us'&&countValid(raw.lanes_open)?raw.lanes_open:null});
  }
  function classify(snapshot,id,dir,vehicle,category,now=Date.now()){
    return {...classifyReading(snapshot,snapshot?.directions?.[dir]?.[id],dir,vehicle,category,now),crossing:id};
  }
  function presentation(snapshot,id,dir,vehicle,category,now=Date.now()){
    const part=c=>({category:c,v:classify(snapshot,id,dir,vehicle,c,now)});
    if(vehicle==='passenger'&&category==='nexus'){
      if(dir==='us')return {paired:true,canadaGeneral:false,parts:[part('nexus'),part('regular')]};
      return {paired:false,canadaGeneral:true,parts:[part('regular')]};
    }
    return {paired:false,canadaGeneral:false,parts:[part(category)]};
  }
  const FIXED_IDS=['ambassador','tunnel','gordie'];
  function orderedCrossings(snapshot,sort,vehicle,category,favorite,now=Date.now()){
    if(sort==='fixed')return FIXED_IDS.includes(favorite)?[favorite,...FIXED_IDS.filter(x=>x!==favorite)]:[...FIXED_IDS];
    const cat=sort==='ca'&&vehicle==='passenger'&&category==='nexus'?'regular':category;
    const rows=FIXED_IDS.map((id,index)=>({id,index,v:classify(snapshot,id,sort,vehicle,cat,now)}));
    return rows.sort((a,b)=>Number(b.v.sortEligible)-Number(a.v.sortEligible)||
      (a.v.sortEligible&&b.v.sortEligible?a.v.minutes-b.v.minutes:0)||a.index-b.index).map(x=>x.id);
  }
  function readPreferences(storage){
    const read=k=>{try{return storage?.getItem(k)??null}catch{return null}};
    const vehicleRaw=read('nexus-vehicle'),laneRaw=read('nexus-lane');
    const vehicle=vehicleRaw==='commercial'?'commercial':'passenger';
    const invalid=vehicleRaw!==null&&!['passenger','commercial'].includes(vehicleRaw)||
      laneRaw!==null&&!VALID_CATEGORIES[vehicle].includes(laneRaw);
    const lane=invalid?'regular':laneRaw??(vehicle==='passenger'?'nexus':'regular');
    const sort=read('nexus-m1-sort'),theme=read('nexus-theme'),favorite=read('nexus-favorite');
    return {vehicle,lane,sort:['fixed','ca','us'].includes(sort)?sort:'fixed',
      theme:['light','dark'].includes(theme)?theme:null,favorite:FIXED_IDS.includes(favorite)?favorite:null,invalid};
  }
  function savePreference(storage,key,value){
    try{if(!storage||typeof storage.setItem!=='function')return false;storage.setItem(key,String(value??''));return true}catch{return false}
  }

  return {classify,classifyReading,presentation,orderedCrossings,readPreferences,savePreference,sourceClocks,IDS,NAMES,age,reading,usable,recommendationReady,noticeKind,crossing,evaluate,publishedNexusWindow,
    countrySide,nextNexusSchedule,scheduledNexusLaneCount,dwtNexusLane,MAX_OPERATOR_AGE,READING_CURRENT_AGE,READING_AGING_AGE,READING_STALE_AGE,READING_EXPIRE_AGE,SNAPSHOT_RECENT_AGE,
    RECOMMEND_MAX_AGE,RECOMMEND_MAX_OBSERVATION_GAP};
});
