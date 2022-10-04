import { writable } from "svelte/store";

export let notifications = writable([]);

let $notifications = [];

notifications.subscribe((v) => ($notifications = v));

export default {
  show(text, { timeout = 5000, dismissable = true } = {}) {
    let id = Math.random().toString(36).slice(2);
    notifications.update((i) => [
      ...i,
      {
        timer: setTimeout(() => {
          this.hide(id);
        }, timeout),
        dismissable,
        id,
        text,
      },
    ]);
    setInterval(() => {
      if ($notifications.length > 3) {
        this.hide($notifications[0].id);
      }
    }, 100);

    return {
      dismiss() {
        this.hide(id);
      },
    };
  },
  hide(id) {
    notifications.update((i) => i.filter((j) => j.id !== id));
  },
};
