<script>
  import { notifications } from "./notifs.js";

  function del(id) {
    return () => {
      $notifications = $notifications.filter((j) => j.id !== id);
    };
  }

  $: notifs = $notifications;

  import { quintOut } from "svelte/easing";
  import { crossfade } from "svelte/transition";
  import { flip } from "svelte/animate";

  const [send, receive] = crossfade({
    duration: (d) => Math.sqrt(d * 200),

    fallback(node, params) {
      const style = getComputedStyle(node);
      const transform = style.transform === "none" ? "" : style.transform;

      return {
        duration: 600,
        easing: quintOut,
        css: (t) => `
					transform: ${transform} scale(${t});
					opacity: ${t}
				`,
      };
    },
  });
</script>

<div id="notifications_container" class="hidden-print">
  {#each notifs as notif (notif.id)}
    <div
      class="notification"
      id={notif.id}
      in:receive={{ key: notif.id }}
      out:send={{ key: notif.id }}
      animate:flip={{ duration: 200 }}
    >
      <span id="text">{notif.text}</span>
      {#if notif.dismissable}
        <button class="dismiss" on:click={del(notif.id)}>x</button>
      {/if}
    </div>
  {/each}
</div>

<style>
  #notifications_container {
    font-family: "Work Sans", Montserrat, Roboto, "Gill Sans", "Gill Sans MT",
      Calibri, "Trebuchet MS", sans-serif;
    position: fixed;
    right: 50%;
    bottom: 1rem;
    transform: translateX(50%);
  }
  #notifications_container .notification {
    position: relative;
    color: #055;
    background: rgba(0, 85, 85, 0.1);
    border-radius: 0.3rem;
    margin: 0.3rem;
    padding: 0.5rem 1rem;
    cursor: pointer;
    transition: background-color 0.3s ease;
    border: 2px solid rgba(0, 85, 85, 0.2);
    min-width: 16rem;
    width: fit-content;
    max-width: 35rem;
  }
  #notifications_container .notification:hover {
    background: rgba(0, 85, 85, 0.05);
  }
  #notifications_container .notification .dismiss {
    position: absolute;
    right: 0.5rem;
    top: 0.5rem;
    bottom: 0.5rem;
    width: 1.5rem;
    background: rgba(255, 255, 255, 0.5);
    border: 2px solid rgba(0, 85, 85, 0.1);
    display: flex;
    justify-content: center;
    align-items: center;
    color: #055;
    border-radius: 0.2rem;
  }
  #notifications_container .notification #text {
    margin-right: 2.5rem;
  }
</style>
