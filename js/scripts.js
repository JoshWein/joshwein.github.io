// Smooth-scroll in-page nav links, offsetting for the fixed navbar.
document.addEventListener('click', function (e) {
    var link = e.target.closest('a[href^="#"]:not([href="#"])');
    if (!link) {
        return;
    }
    var id = link.hash.slice(1);
    var target = document.getElementById(id) || document.getElementsByName(id)[0];
    if (!target) {
        return;
    }
    e.preventDefault();
    var nav = document.querySelector('nav');
    var top = target.getBoundingClientRect().top + window.scrollY - (nav ? nav.offsetHeight : 0);
    window.scrollTo({ top: top, behavior: 'smooth' });
});

// Highlight the clicked nav link.
document.querySelectorAll('.navbar-nav .nav-link').forEach(function (link) {
    link.addEventListener('click', function () {
        document.querySelectorAll('.navbar-nav .nav-link.active').forEach(function (el) {
            el.classList.remove('active');
        });
        link.classList.add('active');
    });
});
