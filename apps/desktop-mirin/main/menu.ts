import { menu } from "mirinjs";

export function installApplicationMenu(broadcast: (action: string) => void): void {
  menu.setApplicationMenu([
    {
      label: "T3 Code Mirin",
      submenu: [
        { label: "Settings…", accelerator: "Cmd+,", click: () => broadcast("open-settings") },
        { type: "separator" },
        { role: "hide" },
        { role: "hideothers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectall" },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Toggle Sidebar", accelerator: "Cmd+B", click: () => broadcast("sidebar.toggle") },
        {
          label: "Toggle Right Panel",
          accelerator: "Cmd+Alt+B",
          click: () => broadcast("rightPanel.toggle"),
        },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }],
    },
  ]);
}
