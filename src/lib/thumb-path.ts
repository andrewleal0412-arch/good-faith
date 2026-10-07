// Where a stored photo's thumbnail is served (src/app/api/thumbs/[...path]/route.ts, src/lib/thumbs.ts). No server
// imports: the pages that hand out the address and the components that show it share it.

/** The thumbnail route for a photo in the private photos bucket, by its storage path. */
export const thumbPath = (storagePath: string) => `/api/thumbs/${storagePath.split("/").map(encodeURIComponent).join("/")}`;
