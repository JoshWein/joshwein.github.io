$('.progress-bar').css({    
    'background-color': 'rgb(114, 186, 247)'
});

$("#pb1").animate({
    width: "100%"
}, 500);

$("#pb2").animate({
    width: "75%"
}, 500);

$("#pb3").animate({
    width: "45%"
}, 500);

$("#pb4").animate({
    width: "30%"
}, 500);

$("#pb5").animate({
    width: "20%"
}, 500);

$('a[href*=#]:not([href=#])').click(function() {
if (location.pathname.replace(/^\//,'') == this.pathname.replace(/^\//,'') && location.hostname == this.hostname) {
  var target = $(this.hash);
  target = target.length ? target : $('[name=' + this.hash.slice(1) +']');
  if (target.length) {
    $('html,body').animate({
      scrollTop: target.offset().top - $('nav').height()
    }, 1000);
    return false;
  }
}
});