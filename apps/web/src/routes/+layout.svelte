<!--
  The root layout.

  It owns exactly one thing: loading the stylesheet that every route needs. All
  visible chrome belongs to a group — `(app)` has the application shell,
  `(auth)` the public column, `admin` its own placeholder — because a header
  drawn here would be a header the login page, the API proxy's error pages and
  the component showcase all had to opt out of.

  That is the change from phase 1, where this file held the navigation and chose
  a container width from the pathname. Both are gone: the route's location now
  decides its shell.
-->
<script lang="ts">
  import '../app.css';

  let { children } = $props();
</script>

{@render children()}
