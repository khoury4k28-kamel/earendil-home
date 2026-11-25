// The Log tab: the box to write or speak into, anything waiting for a check,
// and the viewer's own past entries by day. Nobody else's entries are here,
// or anywhere: the database only hands a person their own.

import { h } from "../ui.js";
import { logPanel } from "../log.js";

export function render() {
  return h("main", { class: "page page--log" },
    h("div", { class: "page-head__text" }, h("h1", { class: "h1" }, "Log")),
    logPanel({ device: "hub" }));
}
