const signaler = new Signal("projectionist", "projectionist");
const main_element = document.getElementsByTagName("main")[0];
const video_source_input = document.getElementById("src");
const play_button = document.getElementById("play");
const player = document.getElementById("player");
const share_screen = document.getElementById("share-screen");
// there is a bug in firefox
// the mozCaptureStream() call removes the audio from the video element and stream.
// Likely this will be fixed if and when mozCaptureStream stops being prefixed
// For now using a proxi video element for local playback seems to solve this
player.captureStream = player.captureStream || function() {
    const fallback_player = document.getElementById("fallback-player")
	console.debug(this);
	console.debug(player);
    const stream = this.mozCaptureStream.apply(this, arguments);
    fallback_player.srcObject = stream;
    return stream;
}.bind(player);
let remoteStream;
let controlStream;

share_screen.addEventListener("click", async function(ev) {
    const gdmOptions = {
        video: true,
        audio: {
            echoCancellation: false,
            noiseSuppression: false,
            sampleRate: 44100
        }
    };
    let captureStream = null;

    try {
        captureStream = await navigator.mediaDevices.getDisplayMedia(gdmOptions);
    } catch(err) {
        console.error("Error: " + err);
        return
    }
    let tracks = captureStream.getTracks()
    for (let track in tracks) {
        tracks[track].addEventListener('ended', e => {
            console.debug(e);
            console.debug('Capture stream inactive - stop streaming!');
            main_element.setAttribute("data-state", "initial");
        });
    }
    remoteStream = new MediaStream();
    //player.srcObject = captureStream;
    controlStream = captureStream;
    controlStream.onaddtrack = (e) => { updateTracks(e.track); };
    captureStream.getTracks().forEach(track => { updateTracks(track); });
    //player.load();
    main_element.setAttribute("data-state", "sharing");
});

play_button.addEventListener("click", function(ev) {
    ev.preventDefault();
    const video_source_url = URL.createObjectURL(video_source_input.files[0]);
    player.src = video_source_url;
    remoteStream = new MediaStream();
    controlStream = player.captureStream()
    controlStream.onaddtrack = (e) => { updateTracks(e.track); };
    player.load();
});

// states
video_source_input.addEventListener("change", function(ev) {
    main_element.setAttribute("data-state", "ready");
    document.getElementById("movie-name").innerHTML = ` ${video_source_input.files[0].name}`;
});

player.addEventListener("play", function() {
    main_element.setAttribute("data-state", "playing");
})


const connections = {};

function updateTracks(track) {
    for (let conn in connections) {
		console.debug("updating tracks", conn)
        connections[conn].addTrack(track, remoteStream);
    }
}

async function main() {
    console.debug("loading application");
    await signaler.configure();

    signaler.onmessage = async (msg) => {
        if (!(msg.from in connections)) {
            const projectionist = new RTCPeerConnection(servers);

            connections[msg.from] = projectionist;

            projectionist.onconnectionstatechange = function(event) {
                console.debug(msg.from, "connection state:", event);
                switch(projectionist.connectionState) {
                    case "disconnected":
                    case "failed":
                    case "closed":
                        delete connections[msg.from];
                        break;
                }
            }

            // if there is a movie playing
            if (controlStream) {
                controlStream.getTracks().forEach(track => {
                    try {
                        projectionist.addTrack(track, remoteStream)
                    } catch (err) {
                        console.error(msg.from, err);
                    }
                });
            }

            configure(projectionist, signaler, msg.from);
        }
        await connections[msg.from].onmessage(msg);
    };

}
main();

function configure(projectionist, signaler, peer) {
    projectionist.onicecandidate = ({candidate}) => signaler.send({candidate, from: "projectionist", to: peer});

    projectionist.onnegotiationneeded = async () => {
        try {
            await projectionist.setLocalDescription(await projectionist.createOffer());
            signaler.send({ description: projectionist.localDescription, from: "projectionist", to: peer });
        } catch(err) {
            console.error(err);
        } 
    };

    projectionist.onmessage = async ({ description, candidate, from, to }) => {
        let pc = projectionist;

        try {
            if (description) {

                try {
                    await pc.setRemoteDescription(description);
                } catch(err) {
                    console.error(to, err);
                    return;
                } finally {
                    if (description.type =="offer") {
                        await pc.setLocalDescription(await pc.createAnswer());
                        signaler.send({description: pc.localDescription, from: to , to: from});
                    }
                }
            } else if (candidate) {
                await pc.addIceCandidate(candidate);
            }
        } catch(err) {
            console.error(err);
        }
    }

    return projectionist;
}
