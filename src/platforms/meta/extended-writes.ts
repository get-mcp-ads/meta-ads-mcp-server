/** Copyright 2026 getmcpads. SPDX-License-Identifier: Apache-2.0 */
import {z} from 'zod';
import type {ToolShape} from '../../tool-quality.js';
import {toMinorUnits} from '../../core/money.js';
import {readBoundedJson} from '../../core/http.js';
type Row=Record<string,any>;
type Collector={tool:(name:string,description:string,shape:ToolShape,handler:(args:Row)=>Promise<unknown>)=>void};
// Discover larger write schemas on demand; keep tools/list compact for every host.
export const DEFERRED_META_WRITES = new Set([
 'meta_create_campaign',
 'meta_create_adset','meta_update_adset_configuration','meta_duplicate_adset',
 'meta_create_adcreative','meta_create_ad','meta_update_ad_creative',
 'meta_upload_ad_image','meta_upload_ad_video','meta_create_custom_audience',
 'meta_update_custom_audience','meta_create_product_set','meta_update_product_set','meta_batch_catalog_items',
]);
const parameterDescriptions:Record<string,string>={
 adAccountId:'Selected owning ad account ID, with or without act_. Every referenced ad object must belong to it.',
 adSetId:'Numeric ID of the existing ad set in the selected account.',
 campaignId:'Numeric ID of the parent campaign in the selected account. Its budget model and objective determine compatible ad set settings.',
 creativeId:'Numeric ID of an existing ad creative in the selected account; not an image hash or video ID.',
 adId:'Numeric ID of the existing ad to modify in the selected account.',
 name:'Exact business name to give this object. Do not derive it from an uploaded filename.',
 title:'Optional title for the uploaded video.',
 configuration:'Explicit native Meta ad set settings. First read meta_get_adset_configuration for edits. A supplied targeting object replaces the entire targeting spec.',
 dailyBudget:'Daily budget in major account-currency units, e.g. 10 means EUR 10. Cannot be combined with lifetimeBudget or a campaign-owned budget.',
 lifetimeBudget:'Total lifetime budget in major account-currency units. Requires an end time; mutually exclusive with dailyBudget.',
 bidAmount:'Bid amount in major account-currency units. Only use with a compatible capped bidding strategy.',
 spec:'Native Meta creative specification: exactly one existing post ID or an object_story_spec with page_id. Put image/video/carousel content in that spec; asset_feed_spec is optional.',
 trackingSpecs:'Optional native Meta tracking specifications. Do not supply credentials.',
 bytesBase64:'Base64 media bytes without a data-URL prefix. Maximum decoded size 5 MiB; omitted from preview output.',
 fileUrl:'Publicly reachable HTTPS video file URL. Must point to the media file, not a landing page or a logged-in player.',
 subtype:'Audience type. CUSTOM creates an empty customer-list container; WEBSITE and ENGAGEMENT require a rule; LOOKALIKE requires an origin and lookalikeSpec.',
 description:'Description of the audience purpose.',rule:'Complete native Meta audience rule. Replaces the existing rule on update.',
 retentionDays:'Audience retention in days, from 1 to 180; Meta enforces eligibility for the selected subtype.',
 pixelId:'Numeric ID of the pixel used by a website audience rule.',originAudienceId:'Numeric ID of the source audience in this same ad account.',
 lookalikeSpec:'Native lookalike specification, including explicit geography and size. Subject to Meta eligibility.',
 customerFileSource:'Actual provenance of future customer-list data. Creating the container does not upload customer data.',
 audienceId:'Numeric ID of the existing custom audience in this selected ad account.',
 catalogId:'Numeric catalog ID. Writes require the catalog and selected ad account to have the same owning Business.',
 productSetId:'Numeric product set ID belonging to catalogId.',filter:'Complete native product-set filter. Updates replace the existing filter.',
 requests:'One to 50 product CREATE or UPDATE requests with retailer_id and native product data. No DELETE; inspect the asynchronous batch result.',
 startTime:'Optional new start time as ISO 8601 with explicit UTC offset.',endTime:'Optional new end time as ISO 8601 with explicit UTC offset, after the start.',
};
const id=z.string().regex(/^\d+$/,'Use a numeric Meta ID');
const accountId=z.string().regex(/^(act_)?\d+$/);
const json=z.record(z.string(), z.unknown());
const name=z.string().trim().min(1).max(400);
const date=z.string().datetime({offset:true});
const amount=z.number().positive().max(1_000_000);
const currency=z.string().regex(/^[A-Z]{3}$/);
const mode={confirm:z.boolean().optional().describe('Apply only when true. Default is a local preview with no API mutation.'),validateOnly:z.boolean().optional().describe('Ask Meta to validate, without creating or changing an object. Mutually exclusive with confirm.')};
const money={currency:currency.optional().describe('Required with any monetary amount. Must match the actual account currency; never assume EUR.'),dailyBudget:amount.optional(),lifetimeBudget:amount.optional(),bidAmount:amount.optional()};
const adsetConfig=z.object({
 optimization_goal:z.string().min(1).optional(),billing_event:z.string().min(1).optional(),
 targeting:json.optional().describe('Complete Meta targeting spec: geography, demographics, custom audiences, exclusions, placements and targeting_automation. Updates replace the entire targeting spec.'),
 promoted_object:json.optional().describe('Native promoted object. Website and app (cross-channel) conversion: {omnichannel_object:{pixel:[{pixel_id,custom_event_type}],app:[{application_id,custom_event_type,object_store_urls:[...]}]}} with the same custom_event_type everywhere; app IDs and store URLs come from meta_get_promotable_apps. Ads in such an ad set need creative applink_treatment and pixel plus app tracking (meta_get_adset_configuration creativeRequirements).'),destination_type:z.string().optional(),
 bid_strategy:z.enum(['LOWEST_COST_WITHOUT_CAP','LOWEST_COST_WITH_BID_CAP','COST_CAP','LOWEST_COST_WITH_MIN_ROAS']).optional(),
 bid_constraints:json.optional(),start_time:date.optional(),end_time:date.optional(),
 attribution_spec:z.array(json).max(10).optional(),attribution_count_type:z.string().optional(),
 dsa_beneficiary:name.optional(),dsa_payor:name.optional(),
 is_dynamic_creative:z.boolean().optional(),pacing_type:z.array(z.string()).optional(),
 adset_schedule:z.array(json).optional(),frequency_control_specs:z.array(json).optional(),
 optimization_sub_event:z.string().optional(),is_incremental_attribution_enabled:z.boolean().optional(),
}).strict();
/** Ad-level destination order for web and app (cross-channel) ad sets. Meta
 * refuses an ad in such an ad set when its creative has none (subcode 2446455).
 * Advantage+ shopping campaigns do not support `automatic`. */
export const APPLINK_TREATMENTS=['deeplink_with_web_fallback','deeplink_with_appstore_fallback','web_only','automatic'] as const;
const deepLink=z.object({url:z.string().trim().min(1).max(2000).describe('App deep link opened on this platform.')}).strict();
export const omnichannelLinkSpec=z.object({
 web:z.object({url:z.string().url().startsWith('https://').max(2000).describe('Website URL. Must equal the creative link (object_story_spec link_data.link).')}).strict().optional(),
 app:z.object({
  application_id:id.describe('App ID promoted by the ad set (promoted_object.omnichannel_object.app[].application_id).'),
  platform_specs:z.object({android:deepLink.optional(),ios:deepLink.optional(),ipad:deepLink.optional(),iphone:deepLink.optional()}).strict().optional(),
 }).strict().optional(),
}).strict().refine(v=>Boolean(v.web||v.app),'omnichannel_link_spec needs web and/or app.')
 .refine(v=>[v.app?.platform_specs?.ios,v.app?.platform_specs?.ipad,v.app?.platform_specs?.iphone].filter(Boolean).length<=1,'Use only one of ios, ipad or iphone in omnichannel_link_spec.app.platform_specs.');
const creativeSpec=z.object({
 object_story_id:z.string().regex(/^\d+_\d+$/).optional(),object_story_spec:json.optional(),
 asset_feed_spec:json.optional(),instagram_user_id:id.optional(),product_set_id:id.optional(),
 degrees_of_freedom_spec:json.optional(),url_tags:z.string().max(4000).optional(),
 contextual_multi_ads:json.optional(),dynamic_ad_voice:z.string().optional(),
 image_crops:json.optional(),template_url:z.string().url().optional(),template_url_spec:json.optional(),
 applink_treatment:z.enum(APPLINK_TREATMENTS).optional().describe('Required when the ad set optimizes for website and app (promoted_object.omnichannel_object with app). Copy the value used by the ad set\'s existing ads (meta_get_adset_configuration creativeRequirements); deeplink_with_web_fallback opens the app when installed with a deep link, else the website. Advantage+ shopping campaigns do not support automatic.'),
 omnichannel_link_spec:omnichannelLinkSpec.optional().describe('Optional web and app destinations for a web and app ad: web.url equal to the creative link, app.application_id from the ad set promoted_object and per-platform deep links. Requires applink_treatment.'),
}).strict();
/** The creative's own website link, wherever the native spec carries it. */
export function creativeLink(spec:Row):string|undefined{
 const story=obj(spec.object_story_spec),link=obj(story.link_data).link??obj(obj(obj(story.video_data).call_to_action).value).link;
 return typeof link==='string'?link:undefined;
}
/** Ad-level tracking that counts both website (pixel) and app events, as Meta
 * documents it for web and app ads. IDs must match the ad set promoted_object. */
export function webAndAppTrackingSpecs(pixelIds:string[],applicationIds:string[]):Row[]{
 return [
  ...(pixelIds.length?[{'action.type':['offsite_conversion'],fb_pixel:pixelIds}]:[]),
  ...(applicationIds.length?[{'action.type':['mobile_app_install'],application:applicationIds},{'action.type':['app_custom_event'],application:applicationIds}]:[]),
 ];
}
/** Pixel and app IDs of a web and app (omnichannel) promoted_object. */
export function omnichannelIds(promoted:unknown):{pixelIds:string[];applicationIds:string[];events:string[]}{
 const omni=obj(obj(promoted).omnichannel_object),list=(v:unknown)=>Array.isArray(v)?v.map(obj):[];
 const pixels=list(omni.pixel),apps=list(omni.app);
 return {pixelIds:pixels.map(p=>String(p.pixel_id??'')).filter(Boolean),applicationIds:apps.map(a=>String(a.application_id??'')).filter(Boolean),
  events:[...pixels,...apps].map(e=>e.custom_event_type).filter((e):e is string=>typeof e==='string')};
}
/** Documented rules for a web and app ad set promoted_object. */
export function validateOmnichannel(promoted:unknown):void{
 const omni=obj(promoted).omnichannel_object;
 if(omni===undefined)return;
 const o=obj(omni),{pixelIds,applicationIds,events}=omnichannelIds(promoted);
 for(const key of ['pixel','app'])if(o[key]!==undefined&&(!Array.isArray(o[key])||!o[key].length))throw new Error(`promoted_object.omnichannel_object.${key} must be a non-empty list.`);
 if(Array.isArray(o.pixel)&&pixelIds.length!==o.pixel.length)throw new Error('Each omnichannel_object.pixel entry needs pixel_id.');
 if(Array.isArray(o.app)){
  if(applicationIds.length!==o.app.length)throw new Error('Each omnichannel_object.app entry needs application_id.');
  for(const app of o.app as Row[])if(app.object_store_urls!==undefined&&(!Array.isArray(app.object_store_urls)||!app.object_store_urls.length||app.object_store_urls.some((u:unknown)=>typeof u!=='string'||!/^https?:\/\//.test(u))))throw new Error('omnichannel_object.app object_store_urls must list the store URLs of that app (see meta_get_promotable_apps).');
 }
 const count=(Array.isArray(o.pixel)?o.pixel.length:0)+(Array.isArray(o.app)?o.app.length:0);
 if(events.length!==count)throw new Error('Each omnichannel_object entry needs custom_event_type.');
 if(new Set(events).size>1)throw new Error('All custom_event_type values in omnichannel_object (app and pixel) must be the same event.');
}
export function validateCreativeDestination(spec:Row):void{
 const omni=spec.omnichannel_link_spec as Row|undefined;
 if(omni&&!spec.applink_treatment)throw new Error('omnichannel_link_spec requires applink_treatment in the same creative.');
 const web=obj(omni?.web).url,link=creativeLink(spec);
 if(typeof web==='string'&&link&&web!==link)throw new Error(`omnichannel_link_spec.web.url must equal the creative link (${link}).`);
}
/** Meta: "When creating cross channel optimization ads, applink_treatment is required in ad's creative". */
export const CREATIVE_DESTINATION_SUBCODE=2446455;
export const CREATIVE_DESTINATION_ACTION='This ad set optimizes for website and app (cross-channel), so the ad\'s creative must carry spec.applink_treatment. Read meta_get_adset_configuration for this adSetId: creativeRequirements.applinkTreatment gives the value used by the ad set\'s own ads (and omnichannelLinkSpec when they use deep links). A Meta creative cannot be edited: create a new creative with these fields, then create the ad with it.';
const out=(data:unknown,isError=false)=>({...(isError?{isError:true}:{}),content:[{type:'text' as const,text:JSON.stringify(data,null,2)}]});
const act=(v:string)=>v.replace(/^act_/,'');
const obj=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const has=(v:unknown)=>v!==undefined&&v!==null;
function clean(v:Row):Row{return Object.fromEntries(Object.entries(v).filter(([,value])=>value!==undefined));}
// Meta can silently replace collection media with the linked Instant Experience's
// hero. Preserve the successful write ID, but stop dependent ads on any mismatch.
function mediaDifferences(requested:unknown,returned:unknown,path=''):Row[]{
 if(!requested||typeof requested!=='object')return [];
 return Object.entries(requested).flatMap(([key,value])=>{
  const field=path?`${path}.${key}`:key,actual=(returned as Row|undefined)?.[key];
  if((['image_hash','video_id','photo_id'].includes(key)||(key==='hash'&&path.startsWith('asset_feed_spec.images.')))&&value!==actual)return [{field,requested:value,returned:actual??null}];
  return mediaDifferences(value,actual,field);
 });
}
function safeJson(value:unknown,depth=0):void {
 if(depth>15)throw new Error('Specification is too deeply nested.');
 if(value&&typeof value==='object')for(const [k,v] of Object.entries(value)){
  if(['access_token','appsecret_proof','__proto__','constructor','prototype'].includes(k))throw new Error(`Forbidden specification key: ${k}`);
  safeJson(v,depth+1);
 }
}
function validateAdsetState(p:Row):void {
 if(p.start_time&&p.end_time&&Date.parse(p.end_time)<=Date.parse(p.start_time))throw new Error('end_time must be after start_time.');
 if(Number(p.lifetime_budget)>0&&!p.end_time)throw new Error('A lifetime budget requires end_time.');
 if(p.bid_strategy==='LOWEST_COST_WITHOUT_CAP'&&Number(p.bid_amount)>0)throw new Error('Automatic lowest-cost bidding cannot include a bid cap.');
 if(['COST_CAP','LOWEST_COST_WITH_BID_CAP'].includes(p.bid_strategy)&&!(Number(p.bid_amount)>0))throw new Error('This bidding strategy requires bidAmount.');
 if(p.bid_strategy==='LOWEST_COST_WITH_MIN_ROAS'&&!(Number(obj(p.bid_constraints).roas_average_floor)>0))throw new Error('Minimum ROAS bidding requires bid_constraints.roas_average_floor.');
}
export function buildAdsetPayload(a:Row,creating:boolean):Row {
 const config=adsetConfig.parse(a.configuration??{});safeJson(config);
 if(has(a.dailyBudget)&&has(a.lifetimeBudget))throw new Error('Choose dailyBudget OR lifetimeBudget, not both.');
 if([a.dailyBudget,a.lifetimeBudget,a.bidAmount].some(has)&&!a.currency)throw new Error('Supply the account currency for monetary amounts.');
 const p:Row={...config};
 for(const [from,to] of [['dailyBudget','daily_budget'],['lifetimeBudget','lifetime_budget'],['bidAmount','bid_amount']])if(has(a[from])){
  p[to]=toMinorUnits(Number(a[from]),String(a.currency));if(p[to]<1)throw new Error(`${from} rounds to zero in ${a.currency}.`);
 }
 if(creating){p.campaign_id=a.campaignId;p.name=a.name;p.status='PAUSED';
  for(const field of ['optimization_goal','billing_event','targeting'])if(!p[field])throw new Error(`${field} is required to create an ad set.`);
 }
 if(p.start_time&&p.end_time&&Date.parse(p.end_time)<=Date.parse(p.start_time))throw new Error('end_time must be after start_time.');
 if(creating&&p.lifetime_budget&&!p.end_time)throw new Error('A lifetime budget requires end_time.');
 const targeting=obj(p.targeting);
 validateOmnichannel(p.promoted_object);
 if(obj(p.promoted_object).custom_conversion_id&&obj(p.promoted_object).pixel_id)throw new Error('For a custom conversion use custom_conversion_id without pixel_id. Meta resolves the pixel through the conversion.');
 if(p.targeting){
  for(const key of ['age_min','age_max'])if(has(targeting[key])&&(!Number.isInteger(targeting[key])||Number(targeting[key])<13||Number(targeting[key])>65))throw new Error(`${key} must be an integer from 13 to 65 (65 means 65+).`);
  if(targeting.locales&&(!Array.isArray(targeting.locales)||targeting.locales.some((v:unknown)=>!Number.isInteger(v)||Number(v)<=0)))throw new Error('Use native numeric locale IDs.');
  const geo=obj(targeting.geo_locations);
  if(geo.countries&&(!Array.isArray(geo.countries)||!geo.countries.length||geo.countries.some((v:unknown)=>typeof v!=='string'||!/^([A-Z]{2})$/.test(v))))throw new Error('countries must contain explicit two-letter uppercase country codes.');
  if(!Object.entries(geo).some(([key,v])=>key!=='location_types'&&Array.isArray(v)&&v.length))throw new Error('Specify nonempty geo_locations explicitly.');
  if(obj(targeting.exclusions).custom_audiences)throw new Error('Use targeting.excluded_custom_audiences for audience exclusions; exclusions.custom_audiences is not supported by Meta.');
  const excluded=new Set((targeting.excluded_custom_audiences??[]).map((v:Row)=>v.id));
  if((targeting.custom_audiences??[]).some((v:Row)=>excluded.has(v.id)))throw new Error('The same custom audience cannot be included and excluded.');
 }
 if(targeting.age_min&&targeting.age_max&&Number(targeting.age_min)>Number(targeting.age_max))throw new Error('Targeting age_min exceeds age_max.');
 if(targeting.exclusions&&(obj(targeting.exclusions).interests||obj(targeting.exclusions).behaviors||obj(targeting.exclusions).demographics))throw new Error('Meta no longer supports detailed-targeting exclusions. Use supported audience or geographic exclusions.');
 if(creating&&!Object.keys(obj(targeting.geo_locations)).length)throw new Error('Specify geo_locations explicitly; no country is assumed.');
 if(p.bid_strategy==='LOWEST_COST_WITHOUT_CAP'&&p.bid_amount)throw new Error('Automatic lowest-cost bidding cannot include a bid cap.');
 if(creating&&['COST_CAP','LOWEST_COST_WITH_BID_CAP'].includes(p.bid_strategy)&&!p.bid_amount)throw new Error('This bidding strategy requires bidAmount.');
 if(creating&&p.bid_strategy==='LOWEST_COST_WITH_MIN_ROAS'&&!obj(p.bid_constraints).roas_average_floor)throw new Error('Minimum ROAS bidding requires bid_constraints.roas_average_floor.');
 if(creating)validateAdsetState(p);
 if(!creating&&!Object.keys(p).length)throw new Error('No ad set change was supplied.');
 return p;
}

/** One account-bound native mutation per call. Never accepts arbitrary Graph paths. */
export function registerMetaExtendedWrites(c:Collector,config:Record<string,string>,readOnly=false):void {
 const base=`https://graph.facebook.com/${config.apiVersion||'v26.0'}`;
 async function graph(path:string,method:'GET'|'POST',data:Row={},file?:{base64:string,name:string}):Promise<Row>{
  const headers={authorization:`Bearer ${config.accessToken}`};
  const query=new URLSearchParams();for(const [k,v] of Object.entries(clean(data)))query.set(k,typeof v==='object'?JSON.stringify(v):String(v));
  let upload:FormData|undefined;
  if(file){upload=new FormData();for(const [k,v] of query)upload.set(k,v);upload.set('source',new Blob([Uint8Array.from(atob(file.base64),ch=>ch.charCodeAt(0))],{type:'video/mp4'}),file.name);}
  let response:Response;
  try{response=await fetch(`${base}/${path}${method==='GET'?'?'+query:''}`,{method,headers:method==='GET'||file?headers:{...headers,'content-type':'application/x-www-form-urlencoded'},...(method==='POST'?{body:upload??query}:{}),signal:AbortSignal.timeout(45000),redirect:"error"});}
  catch{throw Object.assign(new Error(method==='POST'?'Meta did not confirm the mutation. Check the account before retrying; a duplicate may otherwise be created.':'Meta could not be reached.'),{outcome:method==='POST'?'unknown':'not_applied'});}
  let dataOut:Row;try{const parsed:unknown=await readBoundedJson(response);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Invalid Graph response');dataOut=parsed as Row;}catch{throw Object.assign(new Error('Meta returned an unreadable response. Check the object before retrying.'),{httpStatus:response.status,outcome:method==='POST'?'unknown':'not_applied'});}
  if(!response.ok||dataOut.error){
   const e=obj(dataOut.error),code=typeof e.code==='number'?e.code:undefined,subcode=typeof e.error_subcode==='number'?e.error_subcode:undefined;
   // Keep native trace evidence, but never infer that a server failure or an
   // ambiguous/mixed receipt proves a mutation was rejected before application.
   const clientRejection=response.status>=400&&response.status<500&&e.is_transient!==true;
   const acknowledged=has(dataOut.id)||has(dataOut.copied_adset_id)||dataOut.success===true;
   const checkpointRejected=method==='POST'&&clientRejection&&!acknowledged&&code===31&&subcode===3858385;
   const trace=typeof e.fbtrace_id==='string'&&!e.fbtrace_id.includes(config.accessToken)&&/^[A-Za-z0-9_-]{1,200}$/.test(e.fbtrace_id)?e.fbtrace_id:undefined;
   throw Object.assign(new Error(String(e.error_user_msg||e.message||`Meta HTTP ${response.status}`).replaceAll(config.accessToken,'[redacted]').slice(0,700)),{
    code,subcode,httpStatus:response.status,fbtrace_id:trace,checkpointRejected,
    creativeRequirementRejected:method==='POST'&&clientRejection&&!acknowledged&&subcode===CREATIVE_DESTINATION_SUBCODE,
    outcome:method==='GET'||clientRejection&&!acknowledged?'not_applied':'unknown',
   });
  }
  return dataOut;
 }
 async function owned(nodeId:string,account:string,fields='id,account_id'):Promise<Row>{
  const value=await graph(nodeId,'GET',{fields});
  if(String(value.account_id)!==act(account))throw new Error('The target does not belong to the selected ad account. Nothing was changed.');
  return value;
 }
 async function account(account:string,includeBusiness=false){return graph(`act_${act(account)}`,'GET',{fields:includeBusiness?'id,currency,business{id}':'id,currency'});}
 async function catalog(catalogId:string,adAccountId:string){
  const [a,p]=await Promise.all([account(adAccountId,true),graph(catalogId,'GET',{fields:'id,business{id}'})]);
  if(!a.business?.id||String(a.business.id)!==String(p.business?.id))throw new Error('Catalog writes require a catalog owned by the same Business as this selected ad account. Shared catalogs are not writable through this tool.');
 }
 if(readOnly){
  const read=(n:string,d:string,shape:ToolShape,fn:(a:Row)=>Promise<unknown>)=>{const schema=z.object({adAccountId:accountId,...shape}).strict();c.tool(n,d,schema.shape,async raw=>{try{return out(await fn(schema.parse(raw)));}catch(e){return out({error:(e as Error).message},true);}});};
  read('meta_get_entity_configuration','Read a specific entity in its ad account for reconciliation. Read-only; never creates, changes or retries the entity. Missing or normalized fields must be inspected before claiming an exact match.',{
   entityId:id.describe('Exact entity ID saved in the acknowledged creation receipt.'),
   fields:z.array(z.enum(['name','status','objective','daily_budget','lifetime_budget','special_ad_categories','special_ad_category_country','bid_strategy','campaign_id','optimization_goal','billing_event','targeting','promoted_object','bid_amount','bid_constraints','start_time','end_time','attribution_spec','destination_type','is_dynamic_creative','dsa_beneficiary','dsa_payor','adset_id','creative','tracking_specs','conversion_domain','object_story_spec','asset_feed_spec','object_story_id','instagram_actor_id','instagram_user_id','url_tags','degrees_of_freedom_spec','is_adset_budget_sharing_enabled','applink_treatment','omnichannel_link_spec'])).min(1).max(40).describe('Exact fields to re-read from the reviewed native creation payload. IDs and account ownership are always checked.'),
  },async a=>({entity:await owned(a.entityId,a.adAccountId,['id','account_id',...a.fields].join(','))}));
  read('meta_get_uploaded_video','Check video processing and membership in the selected account library. If the first page misses the ID, use the video title to narrow the account-scoped lookup. A direct video read alone never proves membership or readiness. Bounded pagination; not_found is not success.',{videoId:id.describe('Exact uploaded video ID returned by Meta in this account.')},async a=>{
   let after:string|undefined,title:string|undefined;
   for(let page=0;page<6;page++){
    const result=await graph(`act_${act(a.adAccountId)}/advideos`,'GET',clean({fields:'id,status,picture',limit:100,after,title}));
    const video=Array.isArray(result.data)?result.data.find((v:Row)=>String(v.id)===a.videoId):undefined;
    if(video)return {videoId:a.videoId,state:video.status?.video_status??'unknown',ready:video.status?.video_status==='ready',thumbnailUrl:typeof video.picture==='string'?video.picture:undefined};
    if(page===0){
     try{const node=await graph(a.videoId,'GET',{fields:'id,title'});if(String(node.id)===a.videoId&&typeof node.title==='string'&&node.title.trim()){title=node.title;after=undefined;continue;}}catch{/* Keep the account-scoped lookup; metadata failure is not readiness. */}
    }
    const next=result.paging?.cursors?.after;if(!result.paging?.next||!next||next===after)break;after=next;
   }
   return {videoId:a.videoId,state:'not_found_in_recent_library',ready:false};
  });
  // Optional reads: a field this Graph version lacks must not break the ad set read.
  async function optional(path:string,attempts:string[],extra:Row={}):Promise<Row|undefined>{
   for(const fields of attempts){try{return await graph(path,'GET',{...extra,fields});}catch{/* try the next, shorter field list */}}
   return undefined;
  }
  /** What a creative must carry to run in this ad set, read from the ad set and
   * its own ads. Web and app ad sets need applink_treatment (Meta 2446455). */
  async function destinationRequirements(adset:Row):Promise<Row|undefined>{
   const omni=obj(obj(adset.promoted_object).omnichannel_object),apps=Array.isArray(omni.app)?omni.app.filter((a:unknown)=>obj(a).application_id):[];
   const extra=await optional(String(adset.campaign_id),['id,smart_promotion_type,advantage_state_info','id,smart_promotion_type']);
   const shopping=extra?extra.smart_promotion_type==='AUTOMATED_SHOPPING_ADS'||/SHOPPING|SALES/.test(String(obj(extra.advantage_state_info).advantage_state??'')):undefined;
   const page=await optional(`${adset.id}/ads`,['id,name,effective_status,tracking_specs,creative{id,applink_treatment,object_story_spec,omnichannel_link_spec}','id,name,effective_status,tracking_specs,creative{id,applink_treatment,object_story_spec}','id,name,effective_status,creative{id,applink_treatment,object_story_spec}'],{limit:25});
   const ads=(Array.isArray(page?.data)?page!.data:[]).map((ad:Row)=>({adId:String(ad.id),effectiveStatus:ad.effective_status,creativeId:obj(ad.creative).id?String(obj(ad.creative).id):undefined,
    applinkTreatment:typeof obj(ad.creative).applink_treatment==='string'?obj(ad.creative).applink_treatment:undefined,
    omnichannelLinkSpec:obj(ad.creative).omnichannel_link_spec&&typeof obj(ad.creative).omnichannel_link_spec==='object'?obj(ad.creative).omnichannel_link_spec:undefined,link:creativeLink(obj(ad.creative)),
    trackingSpecs:Array.isArray(ad.tracking_specs)?ad.tracking_specs:undefined}));
   const withValue=ads.filter((a:Row)=>APPLINK_TREATMENTS.includes(a.applinkTreatment));
   if(!apps.length&&!withValue.length)return undefined;
   // Prefer delivering ads, then the most frequent value among the ad set's own ads.
   const pool=withValue.some((a:Row)=>a.effectiveStatus==='ACTIVE')?withValue.filter((a:Row)=>a.effectiveStatus==='ACTIVE'):withValue;
   const counts=new Map<string,number>();for(const a of pool)counts.set(a.applinkTreatment,(counts.get(a.applinkTreatment)??0)+1);
   const value=[...counts.entries()].sort((x,y)=>y[1]-x[1])[0]?.[0];
   const reference=pool.find((a:Row)=>a.applinkTreatment===value);
   const linked=pool.find((a:Row)=>a.omnichannelLinkSpec);
   const ids=omnichannelIds(adset.promoted_object);
   // Reference tracking must count both the pixel and the app; otherwise use the documented specs.
   const covers=(specs:Row[])=>specs.some(t=>Array.isArray(t.fb_pixel)&&t.fb_pixel.length)&&specs.some(t=>Array.isArray(t.application)&&t.application.length);
   const tracked=(ads.some((a:Row)=>a.effectiveStatus==='ACTIVE'&&a.trackingSpecs&&covers(a.trackingSpecs))?ads.filter((a:Row)=>a.effectiveStatus==='ACTIVE'):ads).find((a:Row)=>a.trackingSpecs&&covers(a.trackingSpecs));
   const trackingSpecs=tracked?{value:tracked.trackingSpecs,source:'reference_ad',adId:tracked.adId}:ids.pixelIds.length&&ids.applicationIds.length?{value:webAndAppTrackingSpecs(ids.pixelIds,ids.applicationIds),source:'promoted_object'}:undefined;
   return {crossChannel:apps.length>0,applicationIds:apps.map((a:Row)=>String(a.application_id)),pixelIds:ids.pixelIds,advantageShopping:shopping??'unknown',
    ...(trackingSpecs?{trackingSpecs}:{}),
    applinkTreatment:value&&reference?{value,source:'reference_ad',adId:reference.adId,creativeId:reference.creativeId}:{value:'deeplink_with_web_fallback',source:'default',note:'No ad in this ad set exposes applink_treatment. deeplink_with_web_fallback opens the app when it is installed and a deep link exists, otherwise the creative website link.'},
    ...(linked?{omnichannelLinkSpec:{value:linked.omnichannelLinkSpec,adId:linked.adId,creativeId:linked.creativeId,link:linked.link}}:{}),
    referenceAds:ads.slice(0,10),
    note:'Every new creative used in this ad set must carry spec.applink_treatment'+(shopping===true?' (automatic is not supported by Advantage+ shopping campaigns)':'')+'. Copy omnichannel_link_spec only for the same website link, with web.url equal to the creative link. Give each ad trackingSpecs counting the pixel and the app (trackingSpecs).'};
  }
  read('meta_get_adset_configuration','Read an existing ad set, its parent campaign budget/objective and account currency before preparing an edit or adding ads. For a web and app (cross-channel) ad set, creativeRequirements gives the applink_treatment (and omnichannel_link_spec) used by its own ads. Returns native settings; no mutation.',{adSetId:id},async a=>{
   const adset=await owned(a.adSetId,a.adAccountId,'id,name,account_id,campaign_id,status,targeting,promoted_object,optimization_goal,billing_event,bid_strategy,bid_amount,bid_constraints,daily_budget,lifetime_budget,start_time,end_time,attribution_spec,destination_type,is_dynamic_creative,dsa_beneficiary,dsa_payor');
   const [info,campaign]=await Promise.all([account(a.adAccountId),owned(adset.campaign_id,a.adAccountId,'id,name,account_id,objective,status,daily_budget,lifetime_budget,special_ad_categories')]);
   const creativeRequirements=await destinationRequirements(adset);
   return {account:info,campaign,adset,budgetLevel:Number(campaign.daily_budget)>0||Number(campaign.lifetime_budget)>0?'campaign':'adset',
    ...(creativeRequirements?{creativeRequirements}:{}),
    note:'Native money fields are minor units. Targeting updates replace the complete spec. Duplicate an existing ad set to preserve complex settings.'};
  });
  read('meta_get_promotable_apps','List the apps this ad account can advertise, with their store URLs, to set up a website and app (cross-channel) ad set: promoted_object.omnichannel_object.app[] takes application_id and object_store_urls. Read-only.',{},async a=>{
   const page=await optional(`act_${act(a.adAccountId)}/advertisable_applications`,['id,name,object_store_urls','id,name'],{limit:50});
   const apps=(Array.isArray(page?.data)?page!.data:[]).map((app:Row)=>({applicationId:String(app.id),name:typeof app.name==='string'?app.name:undefined,
    objectStoreUrls:[...new Set(Object.values(obj(app.object_store_urls)).filter((u):u is string=>typeof u==='string'&&/^https?:\/\//.test(u)))]}));
   return {apps,...(page?{}:{note:'Meta did not return the advertisable apps of this account. Check that the app is linked to the ad account in Business settings.'})};
  });
  read('meta_get_catalog_batch_status','Read the completion and per-item errors for a catalog batch handle. Acceptance of a batch is not proof that every product succeeded.',{catalogId:id,handle:z.string().min(1).max(1000)},async a=>{await catalog(a.catalogId,a.adAccountId);return graph(`${a.catalogId}/check_batch_request_status`,'GET',{handle:a.handle,load_ids_of_invalid_requests:true});});
  return;
 }
 type Plan={path:string,payload:Row,scope?:()=>Promise<unknown>,readback?:string,validate?:boolean,redact?:Row,async?:boolean,idKey?:string,file?:{base64:string,name:string}};
 function register(n:string,description:string,shape:ToolShape,build:(a:Row)=>Plan|Promise<Plan>){
  const described=Object.fromEntries(Object.entries({adAccountId:accountId,...shape,...mode}).map(([key,value])=>[key,value.description?value:value.describe(parameterDescriptions[key]||key)]));
  const schema=z.object(described).strict();
  c.tool(n,description+' Local preview by default. No automatic retry. Account ownership is checked before Meta validation or mutation.',schema.shape,async raw=>{
   try{
    const a:Row=schema.parse(raw);if(a.confirm&&a.validateOnly)throw new Error('confirm and validateOnly cannot both be true.');
    const p=await build(a);safeJson(p.payload);
    if(a.validateOnly&&!p.validate)throw new Error('This endpoint does not expose validate_only. Use the local preview, then confirm.');
    if(!a.confirm&&!a.validateOnly)return out({applied:false,action:n,adAccountId:`act_${act(a.adAccountId)}`,payload:p.redact??p.payload,validation:{local:true,meta:false,ownershipChecked:false},nextAction:'Review these exact parameters. Use validateOnly where supported, or repeat with confirm:true to apply.'});
    await p.scope?.();
    const result=await graph(p.path,'POST',{...p.payload,...(a.validateOnly?{execution_options:['validate_only']}: {})},p.file);
    if(a.validateOnly){
     if(n==='meta_create_ad'&&(result.success!==true||has(result.id)||has(result.copied_adset_id)))return out({validatedByMeta:false,action:n,result,outcome:'unknown',retrySafe:false,error:'Meta did not return an unambiguous validation success. Inspect any returned object ID before retrying; this response does not authorize a new write.'},true);
     return out({applied:false,validatedByMeta:true,action:n,result});
    }
    let verification:unknown;
    if(p.readback){try{verification=await graph(result[p.idKey||'id']||p.path,'GET',{fields:p.readback});}catch{verification={confirmed:false,message:'Mutation returned success, but readback failed. Read the returned ID; do not recreate it.'};}}
    if(['meta_create_campaign','meta_create_adset','meta_create_ad'].includes(n)&&obj(verification).confirmed!==false){
     verification={...obj(verification),confirmed:obj(verification).status==='PAUSED'&&String(obj(verification).account_id)===act(a.adAccountId)};
    }
    const differences:Row[]=[];
    if(n==='meta_create_adcreative'&&obj(verification).confirmed!==false){
     const media=mediaDifferences(a.spec.object_story_spec,obj(verification).object_story_spec,'object_story_spec');
     media.push(...mediaDifferences(a.spec.asset_feed_spec,obj(verification).asset_feed_spec,'asset_feed_spec'));
     differences.push(...media);
     verification={...obj(verification),confirmed:media.length===0&&String(obj(verification).account_id)===act(a.adAccountId),...(media.length?{message:'Meta returned different or missing media. For collections, check the linked Instant Experience cover. Inspect this existing creative before continuing; do not automatically recreate it.'}:{})};
    }
    if(n==='meta_create_adcreative'&&typeof obj(verification).name==='string'&&obj(verification).name!==a.name){
     differences.push({field:'name',requested:a.name,returned:obj(verification).name,
      note:'The submitted name and Meta readback differ. The cause is not established by this response; do not recreate the creative to force a match.'});
    }
    return out({applied:true,action:n,...(p.async?{processing:'accepted',message:'Accepted for asynchronous processing; this is not confirmation that every item or video is ready.'}:{}),result,verification,...(differences.length?{differences}:{})});
   }catch(error){
    const e=error as Error&{code?:number;subcode?:number;outcome?:string;httpStatus?:number;fbtrace_id?:string;checkpointRejected?:boolean;creativeRequirementRejected?:boolean};
    // A validation request or a failed ownership GET is not an attempted write.
    // Only an exact, conclusive refusal of a confirmed ad creation is reported as rejected:
    // a security checkpoint, or a creative without the web and app destination order
    // (the creative itself cannot be edited; a new one is needed).
    const rejected=n==='meta_create_ad'&&raw.confirm===true&&raw.validateOnly!==true&&(e.checkpointRejected===true||e.creativeRequirementRejected===true);
    return out({error:e.message,code:e.code,subcode:e.subcode,httpStatus:e.httpStatus,fbtrace_id:e.fbtrace_id,outcome:e.outcome||'not_applied',retrySafe:false,
     ...(rejected?{applied:false,outcome:'rejected'}:{}),
     ...(e.subcode===CREATIVE_DESTINATION_SUBCODE?{missingCreativeFields:['applink_treatment'],nextAction:CREATIVE_DESTINATION_ACTION}:{}),
     ...(e.code===31&&e.subcode===3858385?{nextAction:'Meta requires security authentication for this account. Check Ads Manager and Business Support Home with the connecting profile; if no authentication action is visible, contact Meta support with this fbtrace_id. Reconnecting alone does not prove the restriction is cleared.'}:e.subcode===1341012?{nextAction:'Meta refused access to the Page/profile used by this creative. Verify the selected Page, its asset assignments and the token permissions. Repeating the same request will not repair this access.'}:{}),
    },true);
   }
  });
 }
 const checkCurrency=async(a:Row)=>{const info=await account(a.adAccountId);if(a.currency&&info.currency!==a.currency)throw new Error(`Account currency is ${info.currency}, not ${a.currency}. Nothing was changed.`);};
 const budgets={currency:money.currency,dailyBudget:money.dailyBudget.describe('Daily budget in major account-currency units. Mutually exclusive with lifetimeBudget.'),lifetimeBudget:money.lifetimeBudget.describe('Total lifetime budget in major account-currency units. Requires bounded ad set schedules; mutually exclusive with dailyBudget.')};
 const budgetPayload=(a:Row,required=false):Row=>{
  if(has(a.dailyBudget)&&has(a.lifetimeBudget))throw new Error('Choose dailyBudget OR lifetimeBudget, not both.');
  if(required&&!has(a.dailyBudget)&&!has(a.lifetimeBudget))throw new Error('Provide dailyBudget or lifetimeBudget.');
  if((has(a.dailyBudget)||has(a.lifetimeBudget))&&!a.currency)throw new Error('Supply the account currency for monetary amounts.');
  const p:Row={};for(const [from,to]of [['dailyBudget','daily_budget'],['lifetimeBudget','lifetime_budget']])if(has(a[from])){p[to]=toMinorUnits(Number(a[from]),String(a.currency));if(p[to]<1)throw new Error('Budget rounds to zero in the account currency.');}return p;
 };
 register('meta_create_campaign','Create a PAUSED Meta campaign with either ad set budgets (omit campaign budget), a daily campaign budget, or a lifetime campaign budget. Supports native validate_only.',{
  name,objective:z.enum(['OUTCOME_TRAFFIC','OUTCOME_SALES','OUTCOME_LEADS','OUTCOME_AWARENESS','OUTCOME_ENGAGEMENT','OUTCOME_APP_PROMOTION']),
  specialAdCategories:z.array(z.enum(['NONE','HOUSING','EMPLOYMENT','CREDIT','ISSUES_ELECTIONS_POLITICS'])).optional().describe('Required special categories; omit for none.'),
  adsetBudgetSharing:z.boolean().prefault(false).describe('Explicit ad set budget sharing choice; only with ad set budgets.'),
  ...budgets,bidStrategy:adsetConfig.shape.bid_strategy,startTime:date.optional(),endTime:date.optional(),
 },a=>{
  const budget=budgetPayload(a);
  if(Object.keys(budget).length&&a.adsetBudgetSharing)throw new Error('Ad set budget sharing cannot be combined with a campaign budget.');
  if(a.startTime&&a.endTime&&Date.parse(a.endTime)<=Date.parse(a.startTime))throw new Error('endTime must follow startTime.');
  return {path:`act_${act(a.adAccountId)}/campaigns`,payload:clean({name:a.name,objective:a.objective,special_ad_categories:a.specialAdCategories??[],is_adset_budget_sharing_enabled:a.adsetBudgetSharing,status:'PAUSED',...budget,bid_strategy:a.bidStrategy,start_time:a.startTime,stop_time:a.endTime}),validate:true,scope:()=>checkCurrency(a),readback:'id,name,account_id,status,daily_budget,lifetime_budget'};
 });
 const adsetUpdate=(a:Row,payload:Row):Plan=>({path:a.adSetId,payload,validate:true,readback:'id,account_id,status,targeting,optimization_goal,billing_event,start_time,end_time,daily_budget,lifetime_budget,bid_strategy,bid_amount',scope:async()=>{
  await checkCurrency(a);const current=await owned(a.adSetId,a.adAccountId,'id,account_id,campaign_id,start_time,end_time,targeting,optimization_goal,billing_event,bid_strategy,bid_amount,bid_constraints,daily_budget,lifetime_budget');
  validateAdsetState({...current,...payload});
  if(payload.daily_budget||payload.lifetime_budget){const parent=await owned(current.campaign_id,a.adAccountId,'id,account_id,daily_budget,lifetime_budget');if(Number(parent.daily_budget)>0||Number(parent.lifetime_budget)>0)throw new Error('This campaign owns its budget; change it at campaign level.');}
 }});
 register('meta_update_adset_budget','Change an ad set daily or lifetime budget after checking its parent budget and existing schedule. Status stays unchanged.',{adSetId:id,...budgets},a=>adsetUpdate(a,budgetPayload(a,true)));
 register('meta_update_adset_schedule','Change start and/or end time using ISO 8601 with an explicit offset. Check the resulting range against existing dates before any mutation.',{adSetId:id,startTime:date.optional(),endTime:date.optional()},a=>{
  if(!a.startTime&&!a.endTime)throw new Error('Provide startTime or endTime.');
  const p=clean({start_time:a.startTime,end_time:a.endTime});if(a.startTime&&a.endTime&&Date.parse(a.endTime)<=Date.parse(a.startTime))throw new Error('endTime must follow startTime.');return adsetUpdate(a,p);
 });
 register('meta_update_campaign_budget','Change an existing campaign-owned budget after verifying currency and ownership. Does not convert an ad-set-budget campaign or change status.',{campaignId:id,...budgets},a=>({path:a.campaignId,payload:budgetPayload(a,true),validate:true,readback:'id,account_id,status,daily_budget,lifetime_budget',scope:async()=>{
  await checkCurrency(a);const parent=await owned(a.campaignId,a.adAccountId,'id,account_id,daily_budget,lifetime_budget');if(!(Number(parent.daily_budget)>0||Number(parent.lifetime_budget)>0))throw new Error('This campaign has no campaign budget; update its ad set budget.');
 }}));
 register('meta_create_adset','Create a PAUSED Meta ad set with explicit targeting, optimization, placements, attribution, bidding and schedule. Amounts use major account-currency units.',{campaignId:id,name,configuration:adsetConfig,...money},a=>{
  const payload=buildAdsetPayload(a,true);
  return {path:`act_${act(a.adAccountId)}/adsets`,payload,validate:true,readback:'id,name,status,effective_status,account_id,campaign_id,targeting,daily_budget,lifetime_budget',scope:async()=>{
   await checkCurrency(a);const campaign=await owned(a.campaignId,a.adAccountId,'id,account_id,objective,daily_budget,lifetime_budget,special_ad_categories');
   const cbo=Number(campaign.daily_budget)>0||Number(campaign.lifetime_budget)>0;
   if(cbo&&(payload.daily_budget||payload.lifetime_budget))throw new Error('This campaign owns its budget. Omit the ad set budget.');
   if(!cbo&&!payload.daily_budget&&!payload.lifetime_budget)throw new Error('This campaign has no campaign budget. Supply an ad set budget.');
  }};
 });
 register('meta_update_adset_configuration','Update targeting, optimization, placements, attribution, bidding, budget or schedule. Targeting is a COMPLETE replacement, not a partial merge. Status is unchanged.',{adSetId:id,configuration:adsetConfig,...money},a=>{
  const payload=buildAdsetPayload(a,false);
  return adsetUpdate(a,payload);
 });
 register('meta_duplicate_adset','Duplicate a known-good ad set within the selected account, preserving complex native configuration. Always PAUSED and WITHOUT copying ads. Rename it afterwards with meta_rename_adset.',{adSetId:id,campaignId:id.optional(),startTime:date.optional(),endTime:date.optional()},a=>{
  if(a.startTime&&a.endTime&&Date.parse(a.endTime)<=Date.parse(a.startTime))throw new Error('endTime must be after startTime.');
  return {path:`${a.adSetId}/copies`,payload:clean({campaign_id:a.campaignId,start_time:a.startTime,end_time:a.endTime,status_option:'PAUSED',deep_copy:false}),scope:async()=>{await owned(a.adSetId,a.adAccountId);if(a.campaignId)await owned(a.campaignId,a.adAccountId);},idKey:'copied_adset_id',readback:'id,name,status,account_id,campaign_id'};
 });
 register('meta_create_adcreative','Create an ad creative from an existing post or an explicit object_story_spec and optional asset_feed_spec. Supports image, video, carousel, collection and flexible specs. Does not launch an ad.',{name,spec:creativeSpec},a=>{
  const spec=creativeSpec.parse(a.spec);
  if(Number(!!spec.object_story_id)+Number(!!spec.object_story_spec)!==1)throw new Error('Supply exactly one of object_story_id or object_story_spec.');
  validateCreativeDestination(spec);
  if(spec.object_story_spec&&!id.safeParse(spec.object_story_spec.page_id).success)throw new Error('object_story_spec requires an explicit numeric page_id.');
  return {path:`act_${act(a.adAccountId)}/adcreatives`,payload:{name:a.name,...spec},validate:true,scope:()=>account(a.adAccountId),readback:'id,name,account_id,object_story_id,effective_object_story_id,object_story_spec,asset_feed_spec,product_set_id'};
 });
 register('meta_create_ad','Create a PAUSED ad using an existing ad set and creative from the selected account.',{adSetId:id,creativeId:id,name,trackingSpecs:z.array(json).optional()},a=>({path:`act_${act(a.adAccountId)}/ads`,payload:clean({name:a.name,adset_id:a.adSetId,creative:{creative_id:a.creativeId},status:'PAUSED',tracking_specs:a.trackingSpecs}),validate:true,scope:async()=>{await owned(a.adSetId,a.adAccountId);await owned(a.creativeId,a.adAccountId);},readback:'id,name,account_id,status,effective_status,adset_id,creative{id}'}));
 register('meta_update_ad_creative','Replace an ad’s creative with another existing creative from the same account. The ad status is unchanged.',{adId:id,creativeId:id},a=>({path:a.adId,payload:{creative:{creative_id:a.creativeId}},validate:true,scope:async()=>{await owned(a.adId,a.adAccountId);await owned(a.creativeId,a.adAccountId);},readback:'id,account_id,status,creative{id}'}));
 register('meta_upload_ad_image','Upload an image into the selected ad account using base64 bytes (up to 5 MiB decoded). Preview reports size only, never the file body.',{bytesBase64:z.string().min(4).max(7_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/)},a=>{
  let bytes:string;try{bytes=atob(a.bytesBase64);}catch{throw new Error('Invalid base64 image.');}if(bytes.length>5*1024*1024)throw new Error('Image exceeds 5 MiB.');
  return {path:`act_${act(a.adAccountId)}/adimages`,payload:{bytes:a.bytesBase64},redact:{decodedBytes:bytes.length},scope:()=>account(a.adAccountId)};
 });
 register('meta_upload_ad_video','Import a video from a publicly reachable HTTPS URL or base64 MP4 bytes (up to 5 MiB decoded). Meta processes it asynchronously. No campaign is launched.',{fileUrl:z.string().url().startsWith('https://').optional(),bytesBase64:z.string().min(4).max(7_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/).optional(),title:name.optional()},a=>{
  if(Number(!!a.fileUrl)+Number(!!a.bytesBase64)!==1)throw new Error('Supply exactly one of fileUrl or bytesBase64.');
  let decodedBytes:number|undefined;if(a.bytesBase64){try{decodedBytes=atob(a.bytesBase64).length;}catch{throw new Error('Invalid base64 video.');}if(decodedBytes>5*1024*1024)throw new Error('Video exceeds 5 MiB. Use a public media URL for larger files.');}
  return {path:`act_${act(a.adAccountId)}/advideos`,payload:clean({file_url:a.fileUrl,title:a.title}),redact:clean({fileUrl:a.fileUrl,title:a.title,decodedBytes}),...(a.bytesBase64?{file:{base64:a.bytesBase64,name:'video.mp4'}}:{}),scope:()=>account(a.adAccountId),async:true};
 });
 register('meta_create_custom_audience','Create a website, engagement, customer-list container or lookalike audience. Does not upload customer data. Terms and eligibility are enforced by Meta.',{name,subtype:z.enum(['CUSTOM','WEBSITE','ENGAGEMENT','LOOKALIKE']),description:z.string().max(2000).optional(),rule:json.optional(),retentionDays:z.number().int().min(1).max(180).optional(),pixelId:id.optional(),originAudienceId:id.optional(),lookalikeSpec:json.optional(),customerFileSource:z.enum(['USER_PROVIDED_ONLY','PARTNER_PROVIDED_ONLY','BOTH_USER_AND_PARTNER_PROVIDED']).optional()},a=>{
  if(a.subtype==='LOOKALIKE'&&(!a.originAudienceId||!a.lookalikeSpec))throw new Error('A lookalike requires originAudienceId and lookalikeSpec.');
  if(a.subtype==='CUSTOM'&&!a.customerFileSource)throw new Error('Declare customerFileSource explicitly.');
  if(['WEBSITE','ENGAGEMENT'].includes(a.subtype)&&!a.rule)throw new Error('This audience requires a native rule.');
  return {path:`act_${act(a.adAccountId)}/customaudiences`,payload:clean({name:a.name,subtype:a.subtype,description:a.description,rule:a.rule,retention_days:a.retentionDays,pixel_id:a.pixelId,origin_audience_id:a.originAudienceId,lookalike_spec:a.lookalikeSpec,customer_file_source:a.customerFileSource}),scope:async()=>{await account(a.adAccountId);if(a.originAudienceId)await owned(a.originAudienceId,a.adAccountId);},readback:'id,name,account_id,subtype'};
 });
 register('meta_update_custom_audience','Update an existing custom audience name, description, retention or complete rule. Does not change audience membership directly.',{audienceId:id,name:name.optional(),description:z.string().max(2000).optional(),retentionDays:z.number().int().min(1).max(180).optional(),rule:json.optional()},a=>{
  const payload=clean({name:a.name,description:a.description,retention_days:a.retentionDays,rule:a.rule});if(!Object.keys(payload).length)throw new Error('No audience change supplied.');
  return {path:a.audienceId,payload,scope:()=>owned(a.audienceId,a.adAccountId),readback:'id,name,account_id,subtype'};
 });
 register('meta_create_product_set','Create a filtered product set in a catalog owned by the same Business as the selected ad account. Never publishes to Shops.',{catalogId:id,name,filter:json},a=>({path:`${a.catalogId}/product_sets`,payload:{name:a.name,filter:a.filter},scope:()=>catalog(a.catalogId,a.adAccountId),readback:'id,name,filter'}));
 register('meta_update_product_set','Replace a product set filter or rename it. Catalog ownership and set membership are checked before writing.',{catalogId:id,productSetId:id,name:name.optional(),filter:json.optional()},a=>{
  const payload=clean({name:a.name,filter:a.filter});if(!Object.keys(payload).length)throw new Error('No product set change supplied.');
  return {path:a.productSetId,payload,scope:async()=>{await catalog(a.catalogId,a.adAccountId);const set=await graph(a.productSetId,'GET',{fields:'id,product_catalog{id}'});if(String(set.product_catalog?.id)!==a.catalogId)throw new Error('Product set does not belong to the declared catalog.');},readback:'id,name,filter'};
 });
 register('meta_batch_catalog_items','Create or update up to 50 catalog products by retailer_id. Returns asynchronous batch handles; acceptance is not completion. No deletion or automatic upsert.',{catalogId:id,requests:z.array(z.object({method:z.enum(['CREATE','UPDATE']),retailer_id:z.string().min(1).max(100),data:json}).strict()).min(1).max(50)},a=>({path:`${a.catalogId}/batch`,payload:{requests:a.requests,allow_upsert:false},scope:()=>catalog(a.catalogId,a.adAccountId),async:true}));
}

/** Legacy mutations also need an account/object ownership check: an account
 * parameter alone must not authorize a node owned by a different client. */
export async function verifyMetaWriteScope(config:Record<string,string>,a:Row):Promise<void>{
 accountId.parse(a.adAccountId);
 const get=async(node:string,fields:string)=>{
  const response=await fetch(`https://graph.facebook.com/${config.apiVersion||'v26.0'}/${node}?fields=${encodeURIComponent(fields)}`,{headers:{authorization:`Bearer ${config.accessToken}`},signal:AbortSignal.timeout(30000),redirect:"error"});
  let data:Row;try{data=await readBoundedJson<Row>(response);}catch{throw new Error('Cannot verify the Meta target scope. Nothing was changed.');}if(!response.ok||!data||data.error)throw new Error('Cannot verify the Meta target scope. Nothing was changed.');return data;
 };
 const info=await get(`act_${act(a.adAccountId)}`,'id,currency');
 if(a.currency&&info.currency!==a.currency)throw new Error(`Account currency is ${info.currency}, not ${a.currency}. Nothing was changed.`);
 const target=a.adId||a.adSetId||a.campaignId;
 if(target){id.parse(target);const entity=await get(target,'id,account_id');if(String(entity.account_id)!==act(a.adAccountId))throw new Error('The target belongs to a different ad account. Nothing was changed.');}
}
