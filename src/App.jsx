import Sidebar from './components/Sidebar/Sidebar.jsx';
import Main from './components/Main/Main.jsx';
import StatusBar from './components/StatusBar/StatusBar.jsx';
import ModalHost from './components/modals/ModalHost.jsx';
import SyncScreenplay from './components/SyncScreenplay/SyncScreenplay.jsx';

// The shell, in the source's body order. It renders once and never again: the
// legacy code owns everything inside it from then on.
export default function App() {
    return (
        <>
            <Sidebar />
            <Main />
            <StatusBar />
            <ModalHost />
            {/* The top bar's Sync screenplay button (portaled into the shell's rail once it exists). */}
            <SyncScreenplay />
        </>
    );
}
