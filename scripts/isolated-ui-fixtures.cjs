// Isolated browser test transport. All resources are local files; no TCP server,
// external API or physical bridge is contacted. Existing scenario scripts can use:
// node --require ./scripts/isolated-ui-fixtures.cjs scripts/verify-square-flow.cjs
const fs=require("node:fs"),path=require("node:path"),{createRequire}=require("node:module");
const repo=path.resolve(__dirname,".."),app=path.join(repo,"artifacts/robot-control");
const esbuild=createRequire(require.resolve("vite",{paths:[app]}))("esbuild");
const {chromium}=require("playwright");
const bundles=new Map();let serial=0;
const plugin={name:"local-browser-fixture",setup(b){
 b.onLoad({filter:/\.[jt]sx?$/},a=>{
  if(!process.env.ISOLATED_SOURCE_SNAPSHOT)return;
  const snapshot=JSON.parse(fs.readFileSync(process.env.ISOLATED_SOURCE_SNAPSHOT,"utf8")),contents=snapshot[a.path.replaceAll("\\","/")];
  if(contents!==undefined)return {contents,loader:a.path.endsWith(".tsx")?"tsx":"ts",resolveDir:path.dirname(a.path)};
 });
 b.onResolve({filter:/^\/@react-refresh$/},()=>({path:"refresh",namespace:"fixture"}));
 b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"export default {injectIntoGlobalHook(){}};",loader:"js"}));
 b.onResolve({filter:/^\/node_modules\/\.vite\/deps\/(react|react-dom_client)\.js$/},a=>({path:require.resolve(a.path.includes("react-dom")?"react-dom/client":"react",{paths:[app]})}));
 b.onResolve({filter:/^\/src\//},a=>({path:path.join(app,a.path.slice(1))}));
 b.onResolve({filter:/^\/tests\//},a=>({path:path.join(app,a.path.slice(1))}));
 // The repository intentionally contains both AxisLesson.tsx / axisLesson.ts
 // and SuctionZoom.tsx / suctionZoom.ts. Resolve their exact casing on Windows.
 b.onResolve({filter:/^\.\/(AxisLesson|SuctionZoom|PaperCoordinateStudy|axisLesson|suctionZoom|paperCoordinateStudy)$/},a=>({path:path.join(a.resolveDir,a.path+(/[A-Z]/.test(a.path[2])?".tsx":".ts"))}));
}};
async function bundle(code){
 const id=++serial,prefix="/__isolated_fixture/"+id+"/";
 const result=await esbuild.build({stdin:{contents:code,resolveDir:app,sourcefile:"browser-fixture.tsx",loader:"tsx"},
  nodePaths:[path.join(app,"node_modules"),...(process.env.ISOLATED_NODE_MODULES?.split(path.delimiter).filter(Boolean)??[])],conditions:["style","browser","import"],write:false,bundle:true,format:"esm",platform:"browser",outdir:path.join(repo,".isolated-output"),entryNames:"index",
  jsx:"automatic",define:{"import.meta.env.BASE_URL":'"/"',"import.meta.env.DEV":"false","process.env.NODE_ENV":'"production"'},
  plugins:[plugin],loader:{".png":"file",".jpg":"file",".svg":"file",".glb":"file",".stl":"file",".woff2":"file"},
  publicPath:prefix,logLevel:"silent"});
 for(const f of result.outputFiles)bundles.set(prefix+path.relative(path.join(repo,".isolated-output"),f.path).replaceAll("\\","/"),f.contents);
 return '<link rel="stylesheet" href="'+prefix+'index.css"/><script type="module" src="'+prefix+'index.js"></script>';
}
async function prepareHtml(html){
 let code="";
 html=html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi,(whole,attrs,body)=>{
  if(!/type\s*=\s*["']module["']/.test(attrs))return whole;
  const src=attrs.match(/src\s*=\s*["']([^"']+)/)?.[1];
  code+=src?'import "'+src+'";\n':body+"\n";return "";
 });
 return html.replace("</head>",(await bundle(code))+"</head>");
}
const launch=chromium.launch.bind(chromium);
chromium.launch=async options=>{
 // Honour the caller first, then support installed browsers outside Replit.
 if(!fs.existsSync(options.executablePath||"")){
  const installed=[
   process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
   "/repl/tools/bin/chromium",
   "C:/Program Files/Google/Chrome/Application/chrome.exe",
   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].find(p=>p&&fs.existsSync(p));
  if(installed)options={...options,executablePath:installed};else {options={...options};delete options.executablePath;}
 }
 const browser=await launch(options),newContext=browser.newContext.bind(browser);
 browser.newContext=async options=>{
  const context=await newContext(options),route=context.route.bind(context);
  await context.routeWebSocket("**",ws=>ws.close());
  await route("**/*",async r=>{
   const u=new URL(r.request().url()),p=decodeURIComponent(u.pathname);
   // PMREM requires a usable cube size. A 1x1 placeholder can make standard
   // materials disappear under software WebGL, leaving only robot shadows.
   if(u.hostname==="raw.githack.com"&&p.endsWith(".hdr"))return r.fulfill({body:Buffer.concat([Buffer.from("#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 64 +X 128\n"),Buffer.from(Array.from({length:128*64},()=>[128,128,128,129]).flat())])});
   if(!["localhost","127.0.0.1"].includes(u.hostname))return r.abort();
   if(bundles.has(p))return r.fulfill({body:Buffer.from(bundles.get(p)),contentType:p.endsWith(".js")?"text/javascript":p.endsWith(".css")?"text/css":undefined});
   if(p==="/"||p==="/index.html"){
    const html=await prepareHtml(fs.readFileSync(path.join(app,"index.html"),"utf8"));
    return r.fulfill({body:html,contentType:"text/html"});
   }
   if(p.startsWith("/src/")&&/\.tsx?$/.test(p)){
    const html=await bundle("export * from "+JSON.stringify(p)+";"),entry=html.match(/src="([^"]+)"/)[1];
    return r.fulfill({body:Buffer.from(bundles.get(entry)),contentType:"text/javascript"});
   }
   const publicRoot=path.join(app,"public")+path.sep,candidate=path.resolve(publicRoot,"."+p);
   if(candidate.startsWith(publicRoot)&&fs.existsSync(candidate)&&fs.statSync(candidate).isFile())return r.fulfill({body:fs.readFileSync(candidate)});
   return r.fulfill({status:404,body:"No isolated fixture resource: "+p});
  });
  // Scenario scripts retain their own API mocks and HTML fixtures.
  context.route=(pattern,handler,options)=>route(pattern,r=>{
   const proxy=new Proxy(r,{get(target,prop){
    if(prop==="fulfill")return async response=>{
     if(response.contentType==="text/html"&&typeof response.body==="string")response={...response,body:await prepareHtml(response.body)};
     return target.fulfill(response);
    };
    const value=Reflect.get(target,prop);return typeof value==="function"?value.bind(target):value;
   }});
   return handler(proxy);
  },options);
  return context;
 };
 return browser;
};
