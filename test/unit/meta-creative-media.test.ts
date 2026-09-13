import {describe,it,expect} from 'vitest';
import {metaCreativeMedia} from '../../src/platforms/meta/creative-media';
const url = 'https://scontent.xx.fbcdn.net/cover.jpg';
describe('Meta ad media rather than uploaded/catalog inventory',()=>{
  it('excludes catalog templates even when Meta returns a product thumbnail',()=>{
    expect(metaCreativeMedia({product_set_id:'p',thumbnail_url:url,object_story_spec:{template_data:{image_url:'{{product.image_url}}'}}})).toEqual({format:'catalog_dpa',media:[]});
  });
  it.each(['image','video'])('retains an explicit %s collection cover, without catalog children',kind=>{
    const cover = kind==='image'?{link_data:{image_hash:'cover',product_set_id:'p',child_attachments:[{picture:'https://example.com/product'}]}}:{video_data:{video_id:'v',image_url:url},template_data:{product_set_id:'p'}};
    const result=metaCreativeMedia({object_story_spec:cover});
    expect(result.format).toBe('collection');expect(result.media).toHaveLength(1);
    expect(result.media[0]).toMatchObject(kind==='image'?{image_hash:'cover'}:{video_id:'v'});
  });
  it('keeps ordered mixed carousel media without substituting parent thumbnails',()=>{
    const {media,format}=metaCreativeMedia({thumbnail_url:url,object_story_spec:{link_data:{child_attachments:[{image_hash:'a'},{video_id:'v',picture:url},{image_hash:'b'}]}}});
    expect(format).toBe('carousel');expect(media.map(m=>m.media_id)).toEqual(['image:a','video:v','image:b']);expect(media[0].thumbnail_url).toBeUndefined();
  });
});
