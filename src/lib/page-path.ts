// The request header that tells the app shell's layout which page was asked for (a layout isn't told). The proxy
// (src/proxy.ts) sets it on every page request, over anything the browser sent; the layout uses it to check an address
// that may answer 404 before anything streams (src/app/(landlord)/layout.tsx).
export const PATH_HEADER = "x-gf-path";
