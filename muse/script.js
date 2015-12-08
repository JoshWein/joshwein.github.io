var instruments,
	starterInst, // random starting instrument
	colors,
	canvas,
	ctx,
	ready = 0;
window.onload = function() {
	$('#loading_wrap').fadeIn(1500);
	$('#page').hide();
	$('#target').submit(function () {
		$('#page').show();
		if($('#username').val() == "") {
			loadPage("MuseMan");	
		} else {
			loadPage($('#username').val());			
		}	
		$('#target').html("<h2>loading sounds...</h2>");
		return false;
	});	
}

function loadPage(username) {
	instruments = [[], [], [], [], [], [], [], []]; // Add a new slot for each instrument
	var insts = 8;
	starterInst = Math.floor(Math.random() * insts) + 1;
	colors = [];
	canvas = document.getElementById("gameCanvas");
	ctx = canvas.getContext("2d");

	/* Sounds */

	var drum = new Howl({
		urls: ['instruments/drum.ogg']
	});
	// Generate instruments
	console.log("Loading sounds...");
	for(var i = 0; i < insts; i++) {
		var count = 16;
		for(var j = 1; j <= 16; j++) {
			var path = 'instruments/' + 'ins' + (i+1) + '/note' + j + '.mp3';
			//console.log("Loading sound: " + path + " into: " + i + " " + j);
			instruments[i][count--] = new Howl({
				urls: [path],
				volume: 0
				
			});
		}
	}
	console.log("Done.");
	// Generate Colors
	colors[0] = '#A44444';
	colors[1] = '#00FFB8';
	colors[2] = '#700FD3';
	colors[3] = '#10F043';
	colors[4] = '#203043';
	colors[5] = '#ffff99';
	colors[6] = '#FFAF99';
	colors[7] = '#FF2B99';
	/* End Sounds */
	start(username);
	ready = 1;
}

function start(username) {	
	$('#target').html("<h2>Joining server...</h2>");
	var d = document.getElementById("messagePane");	
	// set up event handlers
	window.addEventListener("resize", resizeCanvas, false);
	window.addEventListener("orientationchange", resizeCanvas, false);
	canvas.addEventListener("mousemove",mouseXY, false);	
	canvas.addEventListener('mousedown', mouseDown, false);
	canvas.addEventListener("mouseup",mouseUp, false);
	canvas.addEventListener("touchmove", touchXY, true);
	canvas.addEventListener("touchstart", touchDown, false);
	canvas.addEventListener("touchend", touchUp, false);	
	$('#gameCanvas').mouseleave(function (e) {
		$('html').css({cursor: 'default'});
	});
	$('#gameCanvas').mouseenter(function (e) {
		$('html').css({cursor: 'none'});
	});

	var newWidth;
	var newHeight;
	var xLines = [],
		yLines = [],
		newWidth = window.innerWidth,
		newHeight = window.innerHeight
		notes = 16;
	
	function resizeCanvas() {
	    wWidth = window.innerWidth;
        wHeight = window.innerHeight;
        marginRight = document.getElementById("messagePane").clientWidth;
        marginTop = document.getElementById("banner").clientHeight;   
        newWidth = wWidth - marginRight; // Width will be full size of screen minus the size of the chat window
        newHeight = wHeight - marginTop; // Height will be full size of screen minus the header size
       // console.log(wHeight+ " " + wWidth + " " + marginRight + " " + newWidth + " " + marginTop + " " + newHeight);
        canvas.width = newWidth;
        canvas.height = newHeight;
        canvasHeight = canvas.clientHeight;
        canvasWidth = canvas.clientWidth;
       	// create pitch lines
        xLineHeight = canvasHeight / notes; // Set space between each line drawn on the x-axis
        xLines = [];
        for (i = 0; i <= notes; i++) {
            xLines.push(parseInt(xLineHeight * i + 0.5, 10));
        }
     	drawCursors();
     	drawLines();
	}
	// Variables for keeping track of everything
	var cursors = [],
	mouse = {},
	mouseIsDown = 0;
	$('#loading_wrap').fadeOut();
	id="tester";
	addCursor(0, 0, id);
	cursors[0].name = username;
		$('#'+starterInst+'.ins').css('border', '2px solid white');
	 	var self = this;
	 	$('.ins').not('#'+starterInst+'.ins').css('border', '1px solid black');	
	/* Socket variable and functions */
	// socket = io();
	// id = 0;
	// $('#sendMes').submit(function () {
	// 	if($('#m').val() == "")
	// 		return false;
	// 	console.log("Sending message");
	// 	socket.emit('chat message', $('#m').val());
	// 	addMessage($('#m').val(), id);
	// 	$('#m').val('');
	// 	return false;
	// });
	// $('#loading_wrap').fadeOut();
	// socket.on('id', function(idd) {
	// 	console.log("id: " + idd);
	// 	id = idd;
	// 	socket.emit('nameSet', username);
	// 	addCursor(0, 0, id);
	// 	cursors[0].name = username;
	// 	$('#'+starterInst+'.ins').css('border', '2px solid white');
	// 	var self = this;
	// 	$('.ins').not('#'+starterInst+'.ins').css('border', '1px solid black');		
	// });
	// socket.on('newName', function(uname, id) {
	// 	console.log("Recieved name: " + uname);
	// 	for (var i = 0; i < cursors.length; i++) {
	// 		if(cursors[i].id == id) {
	// 			console.log("Found id");
	// 			if(cursors[i].name) {
	// 				console.log("Name: ["+cursors[i].name+"]");
	// 				return;
	// 			} else {
	// 				cursors[i].name = uname;
	// 				break;
	// 			}
	// 		}
	// 	}
	// 	socket.emit('nameSet', username);
	// 	socket.emit('cInst', cursors[0].curIns+1);
	// });
	// socket.on('newUser', function(idd) {
	// 	console.log("New user joined id: " + idd);
	// 	addCursor(0, 0, idd);
	// });
	// socket.on('removeUser', function(idd) {
	// 	console.log("User left id: " + idd);
	// 	removeCursor(idd);
	// })
	// socket.on('cInst', function(idd, inst) {
	// 	for (var i = 0; i < cursors.length; i++) {
	// 		if(cursors[i].id == idd) {
	// 			changeInstrument(i, inst);
	// 			break;
	// 		}
	// 	}
	// });
	// socket.on('chat message', function(msg, id) {
	// 	console.log("Recieved Message");
 //    	addMessage(msg, id);
 //  	});
	// socket.on('draw', function(data) {
	// 	//console.log("Drawing...");
	// 	updateCursor(data.x/(2000/newWidth), data.y/(2000/newHeight), data.md, data.id); // Scale coordinates from a 2000 x 2000 scale
	// 	drawCursors();
	// })
	// socket.on('connect_error', function() {
 //    	console.log('Failed to connect to server');
	// });
	/* End socket functions */

	// instrument event handler
	$('.ins').click(function(){
		$(this).css('border', '2px solid white');
		var self = this;
		$('.ins').not(self).css('border', '1px solid black');
		//socket.emit('cInst', $(this).attr("id"));
		changeInstrument(0, $(this).attr("id"));
	});
	// End instrument event handler
	function addMessage(msg, name) {
		for (var i = 0; i < cursors.length; i++) {
			if(cursors[i].id == name) {
				name = cursors[i].name; // Replaces given id with username
				break;
			}
		}
		$('#messages').append($('<li>').text(name+ ": " + msg));
    	var element = document.getElementById("messagePane");
    	element.scrollTop = element.scrollHeight;
	}

	// Cursor object
	function Cursor() {
	  this.x = 0; // x position
	  this.y = 0; // y position
	  this.id = 0; // id
	  this.md = 0; // mouse dow
	  this.setPlay = 0;
	  this.fill = colors[starterInst-1]; // color
	  this.ins = instruments[starterInst-1];
	  this.curIns = starterInst-1;
	  this.currentNote = 1;
	  this.dir = 1;
	  this.str = 3;
	  this.name = "";
	}

	// Event handlers
	function mouseUp(e) {
	    mouseIsDown = 0;
	    cursors[0].setPlay = 0;
	    mouseXY(e);
	}
	 
	function touchUp(e) {
	    mouseIsDown = 0;
	    cursors[0].setPlay = 0;
	    mouseXY(e);
	}

	function mouseDown(e) {
	    mouseIsDown = 1;
	    cursors[0].setPlay = 1;
	    mouseXY(e);
	}

	function touchDown(e) {
	    mouseIsDown = 1;
	    cursors[0].setPlay = 1;
	    touchXY(e);
	}

	function mouseXY(e) {
	    mouse.x = e.pageX - canvas.offsetLeft;
	    mouse.y = e.pageY - canvas.offsetTop;
	    if(mouse.y > newHeight + 50) {
	    	mouse.y = newHeight + 50;
	    }
	    if(mouse.x > newWidth - 20) {
	    	mouse.x = newWidth - 20;
	    }
	    updateCursor(mouse.x, mouse.y - 70, mouseIsDown, id);
	    //socket.emit('mouseCoord',  { x: mouse.x * (2000/newWidth), y: (mouse.y - 70) * (2000/newHeight), md: mouseIsDown, id: id}); // Scale coordinates to a 2000 x 2000 scale
	    drawCursors();
	}

	function touchXY(e) {
		e.preventDefault();
	    mouse.x = e.targetTouches[0].pageX - canvas.offsetLeft;
	    mouse.y = e.targetTouches[0].pageY - canvas.offsetTop;
	    if(mouse.y > newHeight + 50) {
	    	mouse.y = newHeight + 50;
	    }
	    if(mouse.x > newWidth - 20) {
	    	mouse.x = newWidth - 20;
	    }
	    updateCursor(mouse.x, mouse.y - 70, mouseIsDown, id);
	    //socket.emit('mouseCoord',  { x: mouse.x * (2000/newWidth), y: (mouse.y - 70) * (2000/newHeight), md: mouseIsDown, id: id}); // Scale coordinates to a 2000 x 2000 scale
	    drawCursors();
	}
	
	function calculateNote(x, y) {
		var i, j;
		for(i = 0; y + 10 > xLines[i]; i++);
		//console.log("Play note: " + Math.round((xLines[i])* (notes/newHeight)) + " at volume: " + x* (1/newWidth));
		var note = Math.round(xLines[i]* (notes/newHeight));
		if(note === 0) {
			note = 1;
		}
		return [note, x * (1/newWidth)];
	}

	function addCursor(x, y, id) {
		console.log("Adding cursor: " + id);
		var rect = new Cursor;
		rect.x = x;
		rect.y = y;
		rect.id = id;
		cursors.push(rect);
	}

	function removeCursor(id) {
		console.log("Removing cursor: " + id);
		for (var i = 0; i < cursors.length; i++) {
			if(cursors[i].id == id) {
				cursors.splice(i,1);
				break;
			}
		}
	}

	function updateCursor(x, y, md, id) {
		for (var i = 0; i < cursors.length; i++) {
			if(cursors[i].id == id) {
				cursors[i].x = x;
				cursors[i].y = y;
				cursors[i].md = md;
				if(md === 1) {
					cursors[i].setPlay = 1;
				} else {
					cursors[i].setPlay = 0;
				}
				break;
			}
		}
	}

	function drawCursors() {		
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		drawLines();
		 for (var i = 0; i < cursors.length; i++) {
			if(cursors[i].md) {
				cursors[i].str += cursors[i].dir
				ctx.lineWidth = cursors[i].str;
				//console.log(ctx.lineWidth);
				if(cursors[i].str === 15) {
					cursors[i].dir = -1;
				} else if (cursors[i].str === 2) {
					cursors[i].dir = 1;
				}
			} else {
				cursors[i].ins[cursors[i].currentNote].fadeOut(0, 1);
				ctx.lineWidth = 1;
			}
			ctx.strokeStyle = cursors[i].fill;
			ctx.strokeRect(cursors[i].x,cursors[i].y, 20, 20);
			ctx.fillText(cursors[i].name, cursors[i].x + 25, cursors[i].y + 10);
		}
	}
	function drawLines() {
		ctx.beginPath();
		ctx.lineWidth = 1;
        for (i = 0; i < xLines.length; i++) {
            ctx.moveTo(0, xLines[i]);
            ctx.lineTo(newWidth, xLines[i]);
        }
        ctx.strokeStyle = '#000';
        ctx.stroke();
	}

	function playNotes() {
		for (var i = 0; i < cursors.length; i++) {
			if(cursors[i].setPlay) {
				var note = calculateNote(cursors[i].x, cursors[i].y);
				if(cursors[i].currentNote === note[0]) {
					cursors[i].ins[cursors[i].currentNote].fadeOut(note[1], 1);
					cursors[i].ins[cursors[i].currentNote].play();
				} else {
					cursors[i].ins[cursors[i].currentNote].fadeOut(0, 1);				
					cursors[i].currentNote = note[0];
					cursors[i].ins[cursors[i].currentNote].volume(note[1]);
					cursors[i].ins[cursors[i].currentNote].play();
					cursors[i].setPlay = 0;
				}
			} else {
				cursors[i].ins[cursors[i].currentNote].fadeOut(0, 1);
				cursors[i].setPlay = 0;
				cursors[i].md = 0;
			}
		}
	}

	// i = cursor to change, inst = instrument to set to
	function changeInstrument(i, inst) {
		cursors[i].ins = instruments[inst-1];
		cursors[i].curIns = inst-1;
		cursors[i].fill = colors[inst-1];		
		console.log("Changed " + i + " to instrument: " + inst);	
	}

	resizeCanvas();
	// Set tempo
	var myVar = setInterval(playNotes, 125);
	//setInterval(pulse, 750);
	function pulse () {
        canvas.style.background = "linear-gradient(to bottom, rgba(242,242,244,1) 0%,rgba(232,238,242,1) 39%,rgba(232,232,232,1) 100%)";
        /* Permalink - use to edit and share this gradient: http://colorzilla.com/gradient-editor/#f2f2f4+0,e8eef2+39,ced8db+100 */
        setTimeout(dePulse, 125);
    }

    function dePulse () {
    	canvas.style.background = "linear-gradient(to bottom,  rgba(242,245,246,1) 0%,rgba(227,234,237,1) 37%,rgba(200,215,220,1) 100%)";
    }
}