import { redirect } from "next/navigation";

// A landlord's home is Properties. The lease check that used to open here lives at /lease ("Check a lease").
export default function Home() {
  redirect("/units");
}
