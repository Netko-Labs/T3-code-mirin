import { client } from "mirinjs/client";
import type { ShellRouter } from "../main/rpc.ts";

const api = client<ShellRouter>();
const status = document.getElementById("status");

api.backendStatus.on((event) => {
  if (status) status.textContent = event.message;
});
