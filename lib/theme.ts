import { DEFAULT_GOAL, GOAL_COOKIE, GOALS } from "@/lib/goals";

export const THEME_STORAGE_KEY = "threaded-theme";

export type ThemePreference = "dark" | "light" | "system";

/**
 * Runs inline in <head> before first paint, so the saved theme and the active
 * goal accent are applied without a flash. Keep it tiny and dependency-free.
 */
export const preferencesScript = `(function(){try{
var d=document.documentElement;
var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})||"dark";
if(t==="system")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";
d.setAttribute("data-theme",t==="light"?"light":"dark");
var m=document.cookie.match(/(?:^|; )${GOAL_COOKIE}=([^;]+)/);
var g=m&&decodeURIComponent(m[1]);
d.setAttribute("data-goal",${JSON.stringify(GOALS)}.indexOf(g)>-1?g:${JSON.stringify(DEFAULT_GOAL)});
}catch(e){}})()`;
