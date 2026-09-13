import {afterEach,describe,expect,it,vi} from 'vitest';
import {collect} from './catalogue';
import {instagramInsightMetrics} from '../../src/platforms/meta/organic-insights';
afterEach(()=>vi.unstubAllGlobals());
const res=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
async function call(args:Record<string,unknown>){const t=collect('meta_ads',{accessToken:'USER_SECRET'}).find(t=>t.name==='meta_get_organic_content_enrichment')!;const r=await t.handler({includePagePosts:false,includeInstagramMedia:true,includeInsights:true,limit:3,...args}) as any;expect(JSON.stringify(r)).not.toMatch(/USER_SECRET|PAGE_SECRET/);return JSON.parse(r.content[0].text);}
describe('Instagram native insights',()=>{
 it('distinguishes Reels from images, carousels, Stories and legacy videos',()=>{
  expect(instagramInsightMetrics({media_type:'VIDEO',media_product_type:'REELS'})).toContain('ig_reels_avg_watch_time');
  for(const type of ['IMAGE','CAROUSEL_ALBUM'])expect(instagramInsightMetrics({media_type:type,media_product_type:'FEED'})).toEqual(['views','reach','likes','comments','saved','shares','total_interactions']);
  expect(instagramInsightMetrics({media_type:'VIDEO',media_product_type:'FEED'})).toEqual(['reach']);
  expect(instagramInsightMetrics({media_type:'IMAGE',media_product_type:'STORY'})).toEqual(['views','reach']);expect(instagramInsightMetrics({})).toEqual(['reach']);
 });
 it('uses metadata to select metrics; never queries carousel children or substitutes date-range totals for lifetime',async()=>{
  const urls:URL[]=[];vi.stubGlobal('fetch',vi.fn(async(input:any)=>{const u=new URL(String(input));urls.push(u);return res(u.pathname.endsWith('/media')?{data:[{id:'r',media_type:'VIDEO',media_product_type:'REELS'},{id:'c',media_type:'CAROUSEL_ALBUM',media_product_type:'FEED',children:{data:[{id:'child',media_type:'VIDEO'}]}}],paging:{cursors:{after:'cursor'}}}:{data:[{name:'views',period:'lifetime',values:[{value:42}]}]});}));
  const r=await call({instagramAccountId:'ig',since:'2026-09-01',until:'2026-09-08'});
  expect(urls[0].searchParams.get('fields')).toContain('media_product_type');expect(urls[1].searchParams.get('metric')).toContain('ig_reels_avg_watch_time');expect(urls[2].searchParams.get('metric')).not.toContain('ig_reels');expect(urls).toHaveLength(3);expect(urls.slice(1).every(u=>!u.searchParams.has('since'))).toBe(true);
  expect(r.instagram_media[0]).toMatchObject({media_product_type:'REELS',insights_returned_metrics:['views'],insights:{data:[{name:'views',period:'lifetime'}]}});expect(r.paging.instagram_media.cursors.after).toBe('cursor');
 });
 it('does not fetch insights without an explicit request',async()=>{const f=vi.fn(async()=>res({data:[{id:'m',media_type:'VIDEO',media_product_type:'REELS'}]}));vi.stubGlobal('fetch',f);await call({instagramAccountId:'ig',includeInsights:false});expect(f).toHaveBeenCalledTimes(1);});
 it('does one reach fallback for incompatible metrics and keeps partial evidence explicit',async()=>{
  const metrics:string[]=[];vi.stubGlobal('fetch',vi.fn(async(input:any)=>{const u=new URL(String(input));if(u.pathname.endsWith('/media'))return res({data:[{id:'m',media_type:'IMAGE'}]});const m=u.searchParams.get('metric')!;metrics.push(m);return m==='reach'?res({data:[{name:'reach',period:'lifetime',values:[{value:0}]}]}):res({error:{code:100,type:'OAuthException',message:'Invalid metric for this media'}},400);}));
  const r=await call({instagramAccountId:'ig'});expect(metrics).toHaveLength(2);expect(metrics[1]).toBe('reach');expect(r.warnings).toHaveLength(1);expect(r.instagram_media[0].insights_returned_metrics).toEqual(['reach']);expect(r.instagram_media[0].insights.data[0].values[0].value).toBe(0);
 });
 it.each([10,190])('does not retry permission/auth error %i or turn missing insights into zero',async(code)=>{const f=vi.fn(async(input:any)=>new URL(String(input)).pathname.endsWith('/media')?res({data:[{id:'m',media_type:'IMAGE'}]}):res({error:{code,type:'OAuthException',message:'Permission denied'}},400));vi.stubGlobal('fetch',f);const r=await call({instagramAccountId:'ig'});expect(f).toHaveBeenCalledTimes(2);expect(r.instagram_media[0].insights).toBeNull();expect(r.warnings[0].code).toBe(code);});
 it('preserves an empty native result as unavailable data',async()=>{vi.stubGlobal('fetch',vi.fn(async(input:any)=>res(new URL(String(input)).pathname.endsWith('/media')?{data:[{id:'m',media_type:'IMAGE'}]}:{data:[]})));const r=await call({instagramAccountId:'ig'});expect(r.instagram_media[0].insights).toEqual({data:[]});expect(r.instagram_media[0].insights_returned_metrics).toEqual([]);});
});
describe('Facebook Page token isolation',()=>{
 it('derives the token once and retains attachments when insights fail',async()=>{
  const urls:URL[]=[];vi.stubGlobal('fetch',vi.fn(async(input:any,init:any)=>{const u=new URL(String(input));urls.push(u);const auth=new Headers(init.headers).get('authorization');if(u.searchParams.get('fields')==='access_token'){expect(auth).toBe('Bearer USER_SECRET');return res({access_token:'PAGE_SECRET'});}expect(auth).toBe('Bearer PAGE_SECRET');if(u.pathname.endsWith('/insights'))return res({error:{code:10,type:'OAuthException',message:'read_insights required'}},400);expect(u.searchParams.get('fields')).not.toMatch(/likes|comments|insights/);return res({data:[{id:'123_456',message:'Post',attachments:{data:[{type:'photo'}]},shares:{count:2}}]});}));
  const r=await call({pageId:'123',includePagePosts:true,includeInstagramMedia:false});expect(urls).toHaveLength(3);expect(r.page_posts[0]).toMatchObject({message:'Post',counts:{shares:2},insights:null,attachments:{data:[{type:'photo'}]}});expect(r.warnings[0].message).toContain('read_insights');
 });
 it('uses each owning Page for explicit posts, deduplicating tokens and posts',async()=>{
  const tokens:string[]=[],posts:string[]=[];vi.stubGlobal('fetch',vi.fn(async(input:any,init:any)=>{const u=new URL(String(input));const id=u.pathname.split('/').at(-1)!;if(u.searchParams.get('fields')==='access_token'){tokens.push(id);return res({access_token:'PAGE_SECRET_'+id});}posts.push(id);expect(new Headers(init.headers).get('authorization')).toBe('Bearer PAGE_SECRET_'+id.split('_')[0]);return res({id,message:id});}));
  const r=await call({postIds:['123_1','123_2','999_3','123_1'],includePagePosts:true,includeInstagramMedia:false,includeInsights:false});expect(tokens).toEqual(['123','999']);expect(posts).toEqual(['123_1','123_2','999_3']);expect(r.page_posts).toHaveLength(3);
 });
 it('never substitutes a user token when a Page token is unavailable',async()=>{const f=vi.fn(async()=>res({id:'123'}));vi.stubGlobal('fetch',f);const r=await call({pageId:'123',includePagePosts:true,includeInstagramMedia:false});expect(f).toHaveBeenCalledTimes(1);expect(r.page_posts).toEqual([]);expect(r.warnings[0].area).toBe('organic_page_token');});
 it('preserves current Page metrics and native periods',async()=>{vi.stubGlobal('fetch',vi.fn(async(input:any)=>{const u=new URL(String(input));if(u.searchParams.get('fields')==='access_token')return res({access_token:'PAGE_SECRET'});if(u.pathname.endsWith('/insights')){expect(u.searchParams.get('metric')).toBe('post_media_view,post_clicks');return res({data:[{name:'post_media_view',period:'lifetime',values:[{value:12}]}]});}return res({data:[{id:'123_456'}]});}));const r=await call({pageId:'123',includePagePosts:true,includeInstagramMedia:false});expect(r.page_posts[0].insights.data[0].name).toBe('post_media_view');});
});
