// The Log tab: a conversation with the hub, in a column down the middle. What
// the viewer wrote, what the hub made of it, and the box to write or speak
// into. Nobody else's entries are here, or anywhere: the database only hands
// a person their own.

import { h } from "../ui.js";
import { logChat } from "../log.js";

export function render() {
  return h("main", { class: "page page--log" }, logChat());
}
