import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {collect,writeToolNames,allTools} from './catalogue';
const config={accessToken:'private-token',apiVersion:'v26.0'};
const tools=()=>collect('meta_ads',config);
const data=(r:any)=>JSON.parse(r.content[0].text);
const run=async(n:string,a:any)=>data(await tools().find(t=>t.name===n)!.handler(a));
const common={adAccountId:'123'};
const adset={...common,campaignId:'200',name:'Test set',currency:'EUR',dailyBudget:10,configuration:{optimization_goal:'LINK_CLICKS',billing_event:'IMPRESSIONS',targeting:{geo_locations:{countries:['FR']},age_min:18},bid_strategy:'LOWEST_COST_WITHOUT_CAP'}};
let requests:{url:URL,method:string,body:URLSearchParams,headers:Headers}[];
let overrides:Record<string,any>;
beforeEach(()=>{
 requests=[];overrides={};
 vi.stubGlobal('fetch',vi.fn(async(url:any,init:any={})=>{
  expect(init.redirect).toBe("error");
  const u=new URL(String(url)),method=init.method||'GET';requests.push({url:u,method,body:new URLSearchParams(init.body),headers:new Headers(init.headers)});
  const node=u.pathname.split('/').pop()!;
  const value=overrides[`${method}:${node}`]??(method==='POST'?{id:'900',copied_adset_id:'900',success:true}:{id:node,account_id:'123',currency:'EUR',business:{id:'55'},product_catalog:{id:'600'},campaign_id:'200',status:'PAUSED',daily_budget:'0',lifetime_budget:'0'});
  return new Response(JSON.stringify(value),{status:value.error?400:200,headers:{'content-type':'application/json'}});
 }));
});
afterEach(()=>vi.unstubAllGlobals());
const cases:[string,any][]=[
 ['meta_create_adset',adset],
 ['meta_update_adset_configuration',{...common,adSetId:'300',configuration:{targeting:{geo_locations:{countries:['FR']},age_min:25}}}],
 ['meta_duplicate_adset',{...common,adSetId:'300',campaignId:'200'}],
 ['meta_create_adcreative',{...common,name:'Creative',spec:{object_story_spec:{page_id:'44',link_data:{image_hash:'hash',link:'https://example.com'}}}}],
 ['meta_create_ad',{...common,name:'Ad',adSetId:'300',creativeId:'400'}],
 ['meta_update_ad_creative',{...common,adId:'500',creativeId:'400'}],
 ['meta_upload_ad_image',{...common,bytesBase64:'aGVsbG8='}],
 ['meta_upload_ad_video',{...common,title:'Video',fileUrl:'https://example.com/test.mp4'}],
 ['meta_create_custom_audience',{...common,name:'Audience',subtype:'CUSTOM',customerFileSource:'USER_PROVIDED_ONLY'}],
 ['meta_update_custom_audience',{...common,audienceId:'700',name:'New audience'}],
 ['meta_create_product_set',{...common,catalogId:'600',name:'Products',filter:{retailer_id:{is_any:['test']}}}],
 ['meta_update_product_set',{...common,catalogId:'600',productSetId:'800',name:'Products'}],
 ['meta_batch_catalog_items',{...common,catalogId:'600',requests:[{method:'UPDATE',retailer_id:'test',data:{name:'Synthetic product'}}]}],
];
describe('Meta extended writes',()=>{
 it.each(cases)('%s previews without any Graph call',async(n,a)=>{const r=await run(n,a);expect(r.applied).toBe(false);expect(r.validation.meta).toBe(false);expect(requests).toHaveLength(0);});
 it.each(cases)('%s makes exactly one mutation after scope checks',async(n,a)=>{const r=await run(n,{...a,confirm:true});expect(r.applied).toBe(true);const posts=requests.filter(r=>r.method==='POST');expect(posts).toHaveLength(1);expect(requests[0].method).toBe('GET');expect(posts[0].headers.get('authorization')).toBe('Bearer private-token');expect(posts[0].body.has('access_token')).toBe(false);expect(JSON.stringify(r)).not.toContain('private-token');});
 it('publishes writes as writes and support reads as reads',()=>{for(const [n]of cases)expect(writeToolNames('meta_ads')).toContain(n);for(const n of ['meta_get_adset_configuration','meta_get_catalog_batch_status'])expect(allTools().find(t=>t.name===n)?.write).toBe(false);});
 it('converts currencies correctly and never creates active ads',async()=>{const r=await run('meta_create_adset',{...adset,currency:'JPY',dailyBudget:2000,confirm:false});expect(r.payload.daily_budget).toBe(2000);expect(r.payload.status).toBe('PAUSED');const a=await run('meta_create_ad',{...cases[4][1],status:'ACTIVE',confirm:true});expect(a.error).toBeTruthy();expect(requests).toHaveLength(0);});
 it('uses real Meta validation without claiming creation',async()=>{const r=await run('meta_create_adset',{...adset,validateOnly:true});expect(r).toMatchObject({applied:false,validatedByMeta:true});expect(JSON.parse(requests.find(r=>r.method==='POST')!.body.get('execution_options')!)).toEqual(['validate_only']);});
 it.each([
  {dailyBudget:10,lifetimeBudget:100}, {currency:undefined},
  {configuration:{...adset.configuration,optimization_goal:undefined}},
  {configuration:{...adset.configuration,targeting:{geo_locations:{countries:['FR']},age_min:50,age_max:20}}},
  {configuration:{...adset.configuration,end_time:'2027-01-01T00:00:00Z',start_time:'2027-02-01T00:00:00Z'}},
  {configuration:{...adset.configuration,bid_strategy:'COST_CAP'}},
  {configuration:{...adset.configuration,bid_strategy:'LOWEST_COST_WITHOUT_CAP'},bidAmount:2},
  {configuration:{...adset.configuration,targeting:{geo_locations:{countries:['FR']},exclusions:{interests:[{id:'1'}]}}}},
  {configuration:{...adset.configuration,targeting:{}}},
  {configuration:{...adset.configuration,campaign_spec:{}}},
 ])('rejects invalid ad set combinations before any Graph call',async patch=>{const r=await run('meta_create_adset',{...adset,...patch,confirm:true});expect(r.error).toBeTruthy();expect(requests).toHaveLength(0);});
 it('rejects a currency mismatch before mutation',async()=>{const r=await run('meta_create_adset',{...adset,currency:'JPY',confirm:true});expect(r.error).toContain('EUR');expect(requests.every(r=>r.method==='GET')).toBe(true);});
 it('requires an ad set budget when its parent has none',async()=>{const r=await run('meta_create_adset',{...adset,dailyBudget:undefined,confirm:true});expect(r.error).toContain('no campaign budget');expect(requests.every(r=>r.method==='GET')).toBe(true);});
 it('rejects ABO/CBO confusion',async()=>{overrides['GET:200']={account_id:'123',daily_budget:'1000'};const r=await run('meta_create_adset',{...adset,confirm:true});expect(r.error).toContain('campaign owns its budget');});
 it.each(['meta_create_ad','meta_update_ad_creative','meta_duplicate_adset'])('rejects foreign target objects for %s',async n=>{overrides['GET:300']={account_id:'999'};overrides['GET:500']={account_id:'999'};const a=cases.find(c=>c[0]===n)![1];expect((await run(n,{...a,confirm:true})).error).toContain('selected ad account');expect(requests.every(r=>r.method==='GET')).toBe(true);});
 it('rejects a foreign creative even when the ad set matches',async()=>{overrides['GET:400']={account_id:'999'};expect((await run('meta_create_ad',{...cases[4][1],confirm:true})).error).toBeTruthy();expect(requests.every(r=>r.method==='GET')).toBe(true);});
 it('rejects catalog ownership and set membership mismatches',async()=>{overrides['GET:600']={business:{id:'66'}};expect((await run('meta_create_product_set',{...cases[10][1],confirm:true})).error).toContain('same Business');overrides['GET:600']={business:{id:'55'}};overrides['GET:800']={product_catalog:{id:'601'}};expect((await run('meta_update_product_set',{...cases[11][1],confirm:true})).error).toContain('declared catalog');expect(requests.every(r=>r.method==='GET')).toBe(true);});
 it('keeps uploads out of preview content',async()=>{const r=await run('meta_upload_ad_image',cases[6][1]);expect(JSON.stringify(r)).not.toContain('aGVsbG8=');expect(r.payload.decodedBytes).toBe(5);});
 it('rejects token injection and simultaneous validate/apply',async()=>{expect((await run('meta_create_adset',{...adset,validateOnly:true,confirm:true})).error).toBeTruthy();expect((await run('meta_create_adcreative',{...cases[3][1],spec:{object_story_spec:{page_id:'44',access_token:'injected'}}})).error).toContain('Forbidden');expect(requests).toHaveLength(0);});
 it('keeps successful writes successful when readback fails',async()=>{overrides['GET:900']={error:{message:'Denied'}};const r=await run('meta_create_ad',{...cases[4][1],confirm:true});expect(r.applied).toBe(true);expect(r.result.id).toBe('900');expect(r.verification.confirmed).toBe(false);});
 it('does not retry an ambiguous mutation or claim nothing changed',async()=>{const previous=fetch;vi.stubGlobal('fetch',vi.fn((u:any,i:any)=>i?.method==='POST'?Promise.reject(new Error('network')):previous(u,i)));const r=await run('meta_create_ad',{...cases[4][1],confirm:true});expect(r).toMatchObject({outcome:'unknown',retrySafe:false});});
 it('reports platform validation refusal without applying',async()=>{overrides['POST:adsets']={error:{code:100,error_subcode:1885183,message:'App not eligible'}};const r=await run('meta_create_adset',{...adset,validateOnly:true});expect(r).toMatchObject({outcome:'not_applied',code:100,subcode:1885183});expect(r.applied).toBeUndefined();});
 it('protects legacy status mutations from a forged account scope',async()=>{overrides['GET:500']={account_id:'999'};const result=await tools().find(t=>t.name==='meta_update_ad_status')!.handler({...common,adId:'500',status:'PAUSED',confirm:true}) as any;expect(result.isError).toBe(true);expect(requests.every(r=>r.method==='GET')).toBe(true);});
 it('uploads small MP4 bytes as multipart without exposing them in previews',async()=>{
  const args={...common,bytesBase64:'aGVsbG8=',title:'Synthetic video'};
  expect(JSON.stringify(await run('meta_upload_ad_video',args))).not.toContain('aGVsbG8=');
  const result=await run('meta_upload_ad_video',{...args,confirm:true});expect(result.applied).toBe(true);
  const call=(fetch as any).mock.calls.find(([,init]:any[])=>init.method==='POST');
  expect(call[1].body).toBeInstanceOf(FormData);expect(call[1].body.get('source')).toBeInstanceOf(Blob);expect(call[1].headers['content-type']).toBeUndefined();
 });
 it('does not require business_management merely to create an ad set or upload media',async()=>{
  await run('meta_create_adset',{...adset,confirm:true});
  expect(requests.filter(r=>r.url.pathname.endsWith('act_123')).every(r=>!r.url.searchParams.get('fields')?.includes('business'))).toBe(true);
 });
 it('sets the new campaign budget-sharing flag explicitly',async()=>{
  await run('meta_create_campaign',{...common,name:'Campaign',objective:'OUTCOME_TRAFFIC',confirm:true});
  const post=requests.find(r=>r.method==='POST')!;expect(post.body.get('is_adset_budget_sharing_enabled')).toBe('false');expect(post.body.get('status')).toBe('PAUSED');
 });

});

it('reads parent campaign budget and currency for a complete ad set preflight',async()=>{
 overrides['GET:200']={id:'200',account_id:'123',daily_budget:'10000',objective:'OUTCOME_SALES'};
 const result=await run('meta_get_adset_configuration',{...common,adSetId:'300'});
 expect(result.budgetLevel).toBe('campaign');expect(result.campaign.objective).toBe('OUTCOME_SALES');expect(result.account.currency).toBe('EUR');expect(requests.every(r=>r.method==='GET')).toBe(true);
});
it('explains a native Page access refusal without suggesting an unsafe retry',async()=>{
 overrides['POST:adcreatives']={error:{code:10,error_subcode:1341012,message:'Profile access refused'}};
 const result=await run('meta_create_adcreative',{...cases[3][1],confirm:true});
 expect(result.outcome).toBe('not_applied');expect(result.nextAction).toContain('Page');expect(result.retrySafe).toBe(false);
});

it('reports native creative name differences without inventing a cause or retrying',async()=>{
 overrides['GET:900']={id:'900',account_id:'123',name:'Creative native suffix',effective_object_story_id:'44_55'};
 const r=await run('meta_create_adcreative',{...common,name:'Creative',spec:{object_story_id:'44_55'},confirm:true});
 expect(r.applied).toBe(true);expect(r.verification.effective_object_story_id).toBe('44_55');
 expect(r.differences[0]).toMatchObject({field:'name',requested:'Creative',returned:'Creative native suffix'});
 expect(r.differences[0].note).toContain('cause is not established');expect(requests.filter(r=>r.method==='POST')).toHaveLength(1);
 expect(requests.at(-1)!.url.searchParams.get('fields')).toContain('effective_object_story_id');
});
it('reads both ad status fields immediately after creating a paused ad',async()=>{
 overrides['GET:900']={id:'900',account_id:'123',status:'PAUSED',effective_status:'IN_PROCESS'};
 const r=await run('meta_create_ad',{...cases[4][1],confirm:true});expect(r.verification).toMatchObject({status:'PAUSED',effective_status:'IN_PROCESS'});
 expect(requests.at(-1)!.url.searchParams.get('fields')).toContain('effective_status');
});
it('does not verify paused creation if native readback returns active or a foreign account',async()=>{
 for(const verification of [{id:'900',account_id:'123',status:'ACTIVE'},{id:'900',account_id:'999',status:'PAUSED'}]){
  overrides['GET:900']=verification;
  const r=await run('meta_create_campaign',{adAccountId:'123',name:'Paused only',objective:'OUTCOME_TRAFFIC',confirm:true});
  expect(r).toMatchObject({applied:true,result:{id:'900'},verification:{confirmed:false}});
 }
});
it('uses a custom conversion without resubmitting its pixel and rejects the conflicting combination locally',async()=>{
 const args={adAccountId:'123',campaignId:'200',name:'Custom conversion',currency:'EUR',dailyBudget:5,configuration:{optimization_goal:'OFFSITE_CONVERSIONS',billing_event:'IMPRESSIONS',targeting:{geo_locations:{countries:['FR']},locales:[9]},promoted_object:{custom_conversion_id:'800'}}};
 const preview=await run('meta_create_adset',args);expect(preview.payload.promoted_object).toEqual({custom_conversion_id:'800'});
 const before=requests.length;
 const invalid=await run('meta_create_adset',{...args,configuration:{...args.configuration,promoted_object:{custom_conversion_id:'800',pixel_id:'700'}},confirm:true});
 expect(invalid.error).toContain('without pixel_id');expect(requests).toHaveLength(before);
});
it('rejects the legacy nested audience exclusion field before sending it to Meta',async()=>{
 const result=await run('meta_create_adset',{adAccountId:'123',campaignId:'200',name:'Audience fixture',currency:'EUR',dailyBudget:5,configuration:{optimization_goal:'OFFSITE_CONVERSIONS',billing_event:'IMPRESSIONS',targeting:{geo_locations:{countries:['FR']},exclusions:{custom_audiences:[{id:'700'}]}}},confirm:true});
 expect(result.error).toContain('targeting.excluded_custom_audiences');expect(requests).toHaveLength(0);
});

it.each([
 [{link_data:{image_hash:'requested'}},{link_data:{image_hash:'old-canvas-cover'}},false],
 [{video_data:{video_id:'123',image_hash:'thumb'}},{video_data:{video_id:'456',image_hash:'thumb'}},false],
 [{link_data:{child_attachments:[{image_hash:'a'},{image_hash:'b'}]}},{link_data:{child_attachments:[{image_hash:'b'},{image_hash:'a'}]}},false],
 [{link_data:{image_hash:'requested'}},{},false],
 [{link_data:{image_hash:'requested'}},{link_data:{image_hash:'requested'}},true],
])('verifies actual creative media before dependent ads can proceed',async(requested,returned,confirmed)=>{
 overrides['GET:900']={id:'900',account_id:'123',object_story_spec:{page_id:'44',...returned}};
 const r=await run('meta_create_adcreative',{...common,name:'Creative',spec:{object_story_spec:{page_id:'44',...requested}},confirm:true});
 expect(r).toMatchObject({applied:true,result:{id:'900'},verification:{confirmed}});
 if(!confirmed)expect(r.differences.some((d:any)=>/image_hash|video_id/.test(d.field))).toBe(true);
 expect(requests.filter(r=>r.method==='POST')).toHaveLength(1);
 expect(requests.at(-1)!.url.searchParams.get('fields')).toContain('object_story_spec');
});
it('checks asset-feed image hashes as well as story media',async()=>{
 overrides['GET:900']={id:'900',account_id:'123',object_story_spec:{page_id:'44'},asset_feed_spec:{images:[{hash:'unexpected'}]}};
 const r=await run('meta_create_adcreative',{...common,name:'Creative',spec:{object_story_spec:{page_id:'44'},asset_feed_spec:{images:[{hash:'requested'}]}},confirm:true});
 expect(r.verification.confirmed).toBe(false);
 expect(r.differences).toContainEqual({field:'asset_feed_spec.images.0.hash',requested:'requested',returned:'unexpected'});
});
