const REDIRECT_URI = 'https://kuzy000.github.io/spotify-allist/redirect.html';
const CLIENT_ID = '5212671b9f8b495ebfbf9e293ac4a91b';

let accessToken = '';

function login(callback) {
	function getLoginURL(scopes) {
		return 'https://accounts.spotify.com/authorize?client_id=' + CLIENT_ID +
			'&redirect_uri=' + encodeURIComponent(REDIRECT_URI) +
			'&scope=' + encodeURIComponent(scopes.join(' ')) +
			'&response_type=token';
	}

	var url = getLoginURL([
		'user-follow-read',
		'playlist-read-private',
		'playlist-modify-private',
	]);

	var width = 450,
		height = 730,
		left = (screen.width / 2) - (width / 2),
		top = (screen.height / 2) - (height / 2);

	window.addEventListener('message', function (event) {
		var hash = JSON.parse(event.data);
		if (hash.type == 'access_token') {
			callback(hash.access_token);
		}
	}, { once: true });

	var w = window.open(url,
		'Spotify',
		'menubar=no,location=no,resizable=no,scrollbars=no,status=no, width=' + width + ', height=' + height + ', top=' + top + ', left=' + left
	);

}

const sfetch = async (token, uri, opt = {}) => {
	if (!('headers' in opt)) {
		opt.headers = {};
	}

	if (!('Authorization' in opt.headers)) {
		opt.headers.Authorization = 'Bearer ' + token;
	}

	if (uri[0] === '/') {
		uri = 'https://api.spotify.com' + uri;
	}

	while (true) {
		const result = await window.fetch(uri, opt);
		await new Promise(r => setTimeout(r, 500));

		if (result.status == 429 || result.status == 500) {
			let duration = result.headers.get('Retry-After');
			if (!duration) {
				duration = 1;
			}
			console.log('Retry-After: ' + duration + ' beg');
			await new Promise(r => setTimeout(r, (duration + 1) * 1000));
			console.log('Retry-After: ' + duration + ' end');

			continue;
		}

		if (result.status < 200 || result.status >= 300) {
			console.log(result);
		}

		return result;
	}
}

const getItems = async (token, uri, key) => {
	const getKey = (data) => key ? data[key] : data;

	let items = [];
	while (uri) {
		let data = await (await sfetch(token, uri)).json();
		items = items.concat(getKey(data).items);

		uri = getKey(data).next;
	}

	return items;
}

const createPlaylist = async (token, idUser, name) => {
	const body = {
		name: name,
		public: false,
	};

	return sfetch(token, '/v1/users/' + idUser + '/playlists', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body)
	});
}

const getArtists = async (token) => getItems(token, '/v1/me/following?type=artist&limit=50', 'artists');
const getAlbums = async (token, idArtist) => getItems(token, '/v1/artists/' + idArtist + '/albums?include_groups=album,single&limit=50');
const getTracks = async (token, idAlbum) => getItems(token, '/v1/albums/' + idAlbum + '/tracks?limit=50');

const addTracksToPlaylist = async (token, idPlaylist, tracks) => {
	const body = {
		uris: tracks
	};

	return sfetch(token, '/v1/playlists/' + idPlaylist + '/tracks', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body)
	});
}

const addTracks = async (token, idPlaylist, tracks, state, flush = false) => {
	tracks = tracks.map(v => v.uri);
	tracks = tracks.filter(v => {
		if (!state.added.has(v)) {
			state.added.add(v);
			return true;
		}
		return false;
	});

	state.current = state.current.concat(tracks);
	if (flush) {
		await addTracksToPlaylist(token, idPlaylist, state.current);
		state.current = [];
	}
	else {
		while (state.current.length >= 50) {
			await addTracksToPlaylist(token, idPlaylist, state.current.slice(0, 50));
			state.current = state.current.slice(50);
		}
	}
}

const formatDate = d => {
	const day = ('0' + d.getDate()).slice(-2);
	const month = ('0' + (d.getMonth() + 1)).slice(-2);
	const year = d.getFullYear();
	const hours = ('0' + d.getHours()).slice(-2);
	const minutes = ('0' + d.getMinutes()).slice(-2);

	return day + '.' + month + '.' + year + ' ' + hours + ':' + minutes;
}

const templateSource = document.getElementById('result-template').innerHTML;
const template = Handlebars.compile(templateSource);
const resultsPlaceholder = document.getElementById('result');
const loginButton = document.getElementById('btn-login');
const runButton = document.getElementById('btn-run');
const divLogin = document.getElementById('login');
const divMain = document.getElementById('main');
const divStatus = document.getElementById('status');
const divWait = document.getElementById('wait');


const status = str => {
	divStatus.innerHTML = str;
}

loginButton.addEventListener('click', function () {
	login(async function (token) {
		accessToken = token;

		let user = await (await sfetch(token, '/v1/me')).json();
		let artists = await (await sfetch(token, '/v1/me/following?type=artist&limit=1')).json();

		divLogin.style.display = 'none';
		divMain.style.display = 'block';

		status('У тебя ' + artists.artists.total + ' подписок');

		resultsPlaceholder.innerHTML = template(user);
	});
});

runButton.addEventListener('click', async function () {
	let token = accessToken;

	runButton.style.display = 'none';
	divWait.style.display = 'block';
	divStatus.style.textAlign = 'left';
	status('Получение списка подписок...');

	let user = await (await sfetch(token, '/v1/me')).json();

	let artists = await getArtists(token);

	let playlist = await (await createPlaylist(token, user.id, 'all ' + formatDate(new Date()))).json();

	const state = {
		added: new Set(),
		current: [],
	};

	for (const [i, artist] of artists.entries()) {
		const albums = await getAlbums(token, artist.id);
		for (const album of albums) {
			const prefix = (i + 1).toString() + '/' + artists.length.toString();

			status(prefix + ' ' + album.artists.map(v => v.name).join(', ') + " - " + album.name);
			const tracks = await getTracks(token, album.id);

			addTracks(token, playlist.id, tracks, state);
		}
	}

	addTracks(token, playlist.id, [], state, true);
});

