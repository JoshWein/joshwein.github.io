// Activate Carousel
$(document).ready(function() {      
   $('.carousel').carousel('pause');
});
// Enable Carousel Indicators
$(".item").click(function(){
    $("#myCarousel").carousel(1);
    $('.carousel').carousel('pause');
});

// Enable Carousel Controls
$(".left").click(function(){
    $("#myCarousel").carousel("prev");
});
$(".right").click(function(){
    $("#myCarousel").carousel("next");
});