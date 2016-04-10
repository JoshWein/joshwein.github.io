$(function() {
    $('[class^="progress"]').bind('inview', function(event, visible) {
        if (visible === true) {
            $('[class^="progress"]').animate({                
                width: [$('#prog').width(), "swing"]
            }, 1000);
            $('[class^="progress"]').unbind('inview');
            var handler = function() {
                $('[class^="progress"]').animate({                
                    width: [$('#prog').width(), "linear"]
                }, 20);
            };
            $(window).on('resize scroll', handler);
        } else {
            // element has gone out of viewport
        }
    });
});
$('a[href*=#]:not([href=#])').click(function() {
    if (location.pathname.replace(/^\//, '') == this.pathname.replace(
        /^\//, '') && location.hostname == this.hostname) {
        var target = $(this.hash);
        target = target.length ? target : $('[name=' + this.hash.slice(
            1) + ']');
        if (target.length) {
            $('html,body').animate({
                scrollTop: target.offset().top - $('nav').height()
            }, 1000);
            return false;
        }
    }
});
$('li > a').click(function() {
    $('li').removeClass();
    $(this).parent().addClass('active');
});
/* Scroll fade funtion */
$(function() {
    $('[class^="row"]').each(function() {
        $(this).css('opacity', 0) // immediately hide element
            .waypoint(function(direction) {
                if (direction === 'down') {
                    $(this.element).animate({
                        opacity: 1
                    });
                }
            }, {
                offset: '75%'
            });
    });
});
/**
 * author Remy Sharp
 * url http://remysharp.com/2009/01/26/element-in-view-event-plugin/
 */
(function($) {
    function getViewportHeight() {
        var height = window.innerHeight; // Safari, Opera
        var mode = document.compatMode;
        if ((mode || !$.support.boxModel)) { // IE, Gecko
            height = (mode == 'CSS1Compat') ? document.documentElement.clientHeight : // Standards
                document.body.clientHeight; // Quirks
        }
        return height;
    }
    $(window).scroll(function() {
        var vpH = getViewportHeight(),
            scrolltop = (document.documentElement.scrollTop ?
                document.documentElement.scrollTop : document.body.scrollTop
            ),
            elems = [];
        // naughty, but this is how it knows which elements to check for
        $.each($.cache, function() {
            if (this.events && this.events.inview) {
                elems.push(this.handle.elem);
            }
        });
        if (elems.length) {
            $(elems).each(function() {
                var $el = $(this),
                    top = $el.offset().top,
                    height = $el.height(),
                    inview = $el.data('inview') || false;
                if (scrolltop > (top + height) || scrolltop +
                    vpH < top) {
                    if (inview) {
                        $el.data('inview', false);
                        $el.trigger('inview', [false]);
                    }
                } else if (scrolltop < (top + height)) {
                    if (!inview) {
                        $el.data('inview', true);
                        $el.trigger('inview', [true]);
                    }
                }
            });
        }
    });
    // kick the event to pick up any elements already in view.
    // note however, this only works if the plugin is included after the elements are bound to 'inview'
    $(function() {
        $(window).scroll();
    });
})(jQuery);



