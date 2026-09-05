import { redirect } from "next/navigation";

/**
 * There is no separate projector mode any more.
 *
 * `/draft` is already the full-screen board — it is what goes on the TV and it
 * is also what gets typed into, so a second view would only be a second thing
 * to keep in sync on draft night. This route survives as a redirect so any
 * bookmark or tab left open from the earlier build still lands somewhere
 * correct rather than 404ing in front of the room.
 */
export default function ProjectorPage() {
  redirect("/draft");
}
