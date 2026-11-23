// Pick one of the six background textures at random on each visit (see textures.css).
(function () {
  var b = document.body;
  if (!b) return;
  for (var i = 1; i <= 6; i++) b.classList.remove("tex-" + i);
  b.classList.add("tex-" + (1 + Math.floor(Math.random() * 6)));
})();
