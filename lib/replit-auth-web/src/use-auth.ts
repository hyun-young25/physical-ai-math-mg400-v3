import { useCallback,useEffect,useState } from "react";
import type { AuthUser } from "@workspace/api-client-react";
export type { AuthUser };
export function useAuth({basePath="/"}:{basePath?:string}={}){
  const [user,setUser]=useState<AuthUser|null>(null),[isLoading,setLoading]=useState(true);
  useEffect(()=>{
    let live=true;
    fetch("/api/auth/user",{credentials:"include"}).then(res=>{
      if(!res.ok)throw new Error("Authentication unavailable");return res.json() as Promise<{user:AuthUser|null}>;
    }).then(data=>{if(live)setUser(data.user);}).catch(()=>{if(live)setUser(null);}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[]);
  const login=useCallback(()=>{
    const base=basePath;
    const destination=`/api/login?returnTo=${encodeURIComponent(base+"?professor=1")}`;
    // Provider pages cannot authenticate inside the cross-site workspace iframe.
    if(window.top!==window.self)window.open(destination,"_blank","noopener,noreferrer");
    else window.location.assign(destination);
  },[basePath]);
  const logout=useCallback(()=>{window.location.assign(`/api/logout?returnTo=${encodeURIComponent(basePath)}`);},[basePath]);
  return {user,isLoading,isAuthenticated:!!user,login,logout};
}
