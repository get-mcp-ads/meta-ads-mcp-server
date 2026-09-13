/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
import {z} from 'zod';
import type {ToolShape} from '../../tool-quality.js';
import {toMinorUnits} from '../../core/money.js';
type Row=Record<string,any>;
type Collector={tool:(name:string,description:string,shape:ToolShape,handler:(args:Row)=>Promise<unknown>)=>void};
// Discover larger write schemas on demand; keep tools/list compact for every host.
export const DEFERRED_META_WRITES = new Set([
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
const json=z.record(z.unknown());
const name=z.string().trim().min(1).max(400);
const date=z.string().datetime({offset:true});
const amount=z.number().positive().max(1_000_000);
const currency=z.string().regex(/^[A-Z]{3}$/);
const mode={confirm:z.boolean().optional().describe('Apply only when true. Default is a local preview with no API mutation.'),validateOnly:z.boolean().optional().describe('Ask Meta to validate, without creating or changing an object. Mutually exclusive with confirm.')};
const money={currency:currency.optional().describe('Required with any monetary amount. Must match the actual account currency; never assume EUR.'),dailyBudget:amount.optional(),lifetimeBudget:amount.optional(),bidAmount:amount.optional()};
const adsetConfig=z.object({
 optimization_goal:z.string().min(1).optional(),billing_event:z.string().min(1).optional(),
 targeting:json.optional().describe('Complete Meta targeting spec: geography, demographics, custom audiences, exclusions, placements and targeting_automation. Updates replace the entire targeting spec.'),
 promoted_object:json.optional(),destination_type:z.string().optional(),
 bid_strategy:z.enum(['LOWEST_COST_WITHOUT_CAP','LOWEST_COST_WITH_BID_CAP','COST_CAP','LOWEST_COST_WITH_MIN_ROAS']).optional(),
 bid_constraints:json.optional(),start_time:date.optional(),end_time:date.optional(),
 attribution_spec:z.array(json).max(10).optional(),attribution_count_type:z.string().optional(),
 dsa_beneficiary:name.optional(),dsa_payor:name.optional(),
 is_dynamic_creative:z.boolean().optional(),pacing_type:z.array(z.string()).optional(),
 adset_schedule:z.array(json).optional(),frequency_control_specs:z.array(json).optional(),
 optimization_sub_event:z.string().optional(),is_incremental_attribution_enabled:z.boolean().optional(),
}).strict();
const creativeSpec=z.object({
 object_story_id:z.string().regex(/^\d+_\d+$/).optional(),object_story_spec:json.optional(),
 asset_feed_spec:json.optional(),instagram_user_id:id.optional(),product_set_id:id.optional(),
 degrees_of_freedom_spec:json.optional(),url_tags:z.string().max(4000).optional(),
 contextual_multi_ads:json.optional(),dynamic_ad_voice:z.string().optional(),
 image_crops:json.optional(),template_url:z.string().url().optional(),template_url_spec:json.optional(),
}).strict();
const out=(data:unknown,isError=false)=>({...(isError?{isError:true}:{}),content:[{type:'text' as const,text:JSON.stringify(data,null,2)}]});
const act=(v:string)=>v.replace(/^act_/,'');
const obj=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const has=(v:unknown)=>v!==undefined&&v!==null;
function clean(v:Row):Row{return Object.fromEntries(Object.entries(v).filter(([,value])=>value!==undefined));}
function safeJson(value:unknown,depth=0):void {
 if(depth>15)throw new Error('Specification is too deeply nested.');
 if(value&&typeof value==='object')for(const [k,v] of Object.entries(value)){
  if(['access_token','appsecret_proof','__proto__','constructor','prototype'].includes(k))throw new Error(`Forbidden specification key: ${k}`);
  safeJson(v,depth+1);
 }
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
 if(targeting.age_min&&targeting.age_max&&Number(targeting.age_min)>Number(targeting.age_max))throw new Error('Targeting age_min exceeds age_max.');
 if(targeting.exclusions&&(obj(targeting.exclusions).interests||obj(targeting.exclusions).behaviors||obj(targeting.exclusions).demographics))throw new Error('Meta no longer supports detailed-targeting exclusions. Use supported audience or geographic exclusions.');
 if(creating&&!Object.keys(obj(targeting.geo_locations)).length)throw new Error('Specify geo_locations explicitly; no country is assumed.');
 if(p.bid_strategy==='LOWEST_COST_WITHOUT_CAP'&&p.bid_amount)throw new Error('Automatic lowest-cost bidding cannot include a bid cap.');
 if(creating&&['COST_CAP','LOWEST_COST_WITH_BID_CAP'].includes(p.bid_strategy)&&!p.bid_amount)throw new Error('This bidding strategy requires bidAmount.');
 if(creating&&p.bid_strategy==='LOWEST_COST_WITH_MIN_ROAS'&&!obj(p.bid_constraints).roas_average_floor)throw new Error('Minimum ROAS bidding requires bid_constraints.roas_average_floor.');
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
  try{response=await fetch(`${base}/${path}${method==='GET'?'?'+query:''}`,{method,headers:method==='GET'||file?headers:{...headers,'content-type':'application/x-www-form-urlencoded'},...(method==='POST'?{body:upload??query}:{}),signal:AbortSignal.timeout(45000), redirect: "error"});}
  catch{throw Object.assign(new Error(method==='POST'?'Meta did not confirm the mutation. Check the account before retrying; a duplicate may otherwise be created.':'Meta could not be reached.'),{outcome:method==='POST'?'unknown':'not_applied'});}
  let dataOut:Row;try{dataOut=await response.json() as Row;}catch{throw Object.assign(new Error('Meta returned an unreadable response. Check the object before retrying.'),{outcome:method==='POST'?'unknown':'not_applied'});}
  if(!response.ok||dataOut.error){const e=obj(dataOut.error);throw Object.assign(new Error(String(e.error_user_msg||e.message||`Meta HTTP ${response.status}`).replaceAll(config.accessToken,'[redacted]').slice(0,700)),{code:e.code,subcode:e.error_subcode,outcome:'not_applied'});}
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
  read('meta_get_adset_configuration','Read an existing ad set, its parent campaign budget/objective and account currency before preparing an edit. Returns native settings; no mutation.',{adSetId:id},async a=>{
   const adset=await owned(a.adSetId,a.adAccountId,'id,name,account_id,campaign_id,status,targeting,promoted_object,optimization_goal,billing_event,bid_strategy,bid_amount,bid_constraints,daily_budget,lifetime_budget,start_time,end_time,attribution_spec,destination_type,is_dynamic_creative,dsa_beneficiary,dsa_payor');
   const [info,campaign]=await Promise.all([account(a.adAccountId),owned(adset.campaign_id,a.adAccountId,'id,name,account_id,objective,status,daily_budget,lifetime_budget,special_ad_categories')]);
   return {account:info,campaign,adset,budgetLevel:Number(campaign.daily_budget)>0||Number(campaign.lifetime_budget)>0?'campaign':'adset',
    note:'Native money fields are minor units. Targeting updates replace the complete spec. Duplicate an existing ad set to preserve complex settings.'};
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
    if(a.validateOnly)return out({applied:false,validatedByMeta:true,action:n,result});
    let verification:unknown;
    if(p.readback){try{verification=await graph(result[p.idKey||'id']||p.path,'GET',{fields:p.readback});}catch{verification={confirmed:false,message:'Mutation returned success, but readback failed. Read the returned ID; do not recreate it.'};}}
    const differences:Row[]=[];
    if(n==='meta_create_adcreative'&&typeof obj(verification).name==='string'&&obj(verification).name!==a.name){
     differences.push({field:'name',requested:a.name,returned:obj(verification).name,
      note:'The submitted name and Meta readback differ. The cause is not established by this response; do not recreate the creative to force a match.'});
    }
    return out({applied:true,action:n,...(p.async?{processing:'accepted',message:'Accepted for asynchronous processing; this is not confirmation that every item or video is ready.'}:{}),result,verification,...(differences.length?{differences}:{})});
   }catch(error){const e=error as Error&{code?:number;subcode?:number;outcome?:string};return out({error:e.message,code:e.code,subcode:e.subcode,outcome:e.outcome||'not_applied',retrySafe:false,...(e.subcode===1341012?{nextAction:'Meta refused access to the Page/profile used by this creative. Verify the selected Page, its asset assignments and the token permissions. Repeating the same request will not repair this access.'}:{})},true);}
  });
 }
 const checkCurrency=async(a:Row)=>{const info=await account(a.adAccountId);if(a.currency&&info.currency!==a.currency)throw new Error(`Account currency is ${info.currency}, not ${a.currency}. Nothing was changed.`);};
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
  return {path:a.adSetId,payload,validate:true,readback:'id,account_id,status,targeting,optimization_goal,billing_event',scope:async()=>{
   await checkCurrency(a);const current=await owned(a.adSetId,a.adAccountId,'id,account_id,campaign_id,start_time,end_time,targeting,optimization_goal,billing_event,bid_strategy,bid_amount,lifetime_budget');
   const merged={...current,...payload};
   if(merged.start_time&&merged.end_time&&Date.parse(merged.end_time)<=Date.parse(merged.start_time))throw new Error('The resulting end_time must be after start_time.');
   if(Number(merged.lifetime_budget)>0&&!merged.end_time)throw new Error('Lifetime budget requires an end time.');
   if(payload.daily_budget||payload.lifetime_budget){const parent=await owned(current.campaign_id,a.adAccountId,'id,account_id,daily_budget,lifetime_budget');if(Number(parent.daily_budget)>0||Number(parent.lifetime_budget)>0)throw new Error('This campaign owns its budget; change it at campaign level.');}
  }};
 });
 register('meta_duplicate_adset','Duplicate a known-good ad set within the selected account, preserving complex native configuration. Always PAUSED and WITHOUT copying ads. Rename it afterwards with meta_rename_adset.',{adSetId:id,campaignId:id.optional(),startTime:date.optional(),endTime:date.optional()},a=>{
  if(a.startTime&&a.endTime&&Date.parse(a.endTime)<=Date.parse(a.startTime))throw new Error('endTime must be after startTime.');
  return {path:`${a.adSetId}/copies`,payload:clean({campaign_id:a.campaignId,start_time:a.startTime,end_time:a.endTime,status_option:'PAUSED',deep_copy:false}),scope:async()=>{await owned(a.adSetId,a.adAccountId);if(a.campaignId)await owned(a.campaignId,a.adAccountId);},idKey:'copied_adset_id',readback:'id,name,status,account_id,campaign_id'};
 });
 register('meta_create_adcreative','Create an ad creative from an existing post or an explicit object_story_spec and optional asset_feed_spec. Supports image, video, carousel, collection and flexible specs. Does not launch an ad.',{name,spec:creativeSpec},a=>{
  const spec=creativeSpec.parse(a.spec);
  if(Number(!!spec.object_story_id)+Number(!!spec.object_story_spec)!==1)throw new Error('Supply exactly one of object_story_id or object_story_spec.');
  if(spec.object_story_spec&&!id.safeParse(spec.object_story_spec.page_id).success)throw new Error('object_story_spec requires an explicit numeric page_id.');
  return {path:`act_${act(a.adAccountId)}/adcreatives`,payload:{name:a.name,...spec},validate:true,scope:()=>account(a.adAccountId),readback:'id,name,account_id,object_story_id,effective_object_story_id'};
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
  const response=await fetch(`https://graph.facebook.com/${config.apiVersion||'v26.0'}/${node}?fields=${encodeURIComponent(fields)}`,{headers:{authorization:`Bearer ${config.accessToken}`},signal:AbortSignal.timeout(30000), redirect: "error"});
  const data=await response.json() as Row;if(!response.ok||data.error)throw new Error('Cannot verify the Meta target scope. Nothing was changed.');return data;
 };
 const info=await get(`act_${act(a.adAccountId)}`,'id,currency');
 if(a.currency&&info.currency!==a.currency)throw new Error(`Account currency is ${info.currency}, not ${a.currency}. Nothing was changed.`);
 const target=a.adId||a.adSetId||a.campaignId;
 if(target){id.parse(target);const entity=await get(target,'id,account_id');if(String(entity.account_id)!==act(a.adAccountId))throw new Error('The target belongs to a different ad account. Nothing was changed.');}
}
