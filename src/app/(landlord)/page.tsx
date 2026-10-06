import type { Metadata } from "next";
import PropertiesPage from "./units/page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Properties" };

// A landlord's home is Properties, rendered here as well as at /units so the bare address costs no redirect (a
// redirect from a page still renders the whole shell first). The lease check that used to open here lives at /lease.
export default function Home(props: PageProps<"/">) {
  return <PropertiesPage {...(props as unknown as PageProps<"/units">)} />;
}
