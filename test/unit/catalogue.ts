import { registerMeta } from "../../src/platforms/meta/index.js";
export function collect(_platform: string, config: any = {accessToken:"fixture"}) {
  const tools: any[] = [];
  const server = {tool(name: string, description: string, shape: any, handler: any) { tools.push({name,description,shape,handler,write:Object.hasOwn(shape,"confirm")}); },resource() {},registerResource() {},prompt() {} };
  registerMeta(server as never, {...config,logLevel:"error",enableWrites:true} as never);
  return tools;
}
export const allTools = () => collect("fixture");
export const writeToolNames = (platform:string) => collect(platform).filter(t=>t.write).map(t=>t.name);
