import Sidebar from './components/Sidebar/Sidebar.jsx';
import Main from './components/Main/Main.jsx';
import StatusBar from './components/StatusBar/StatusBar.jsx';
import ModalHost from './components/modals/ModalHost.jsx';
import SyncScreenplay from './components/SyncScreenplay/SyncScreenplay.jsx';
import { REACT_COMPONENTS } from './components/react-components.js';
import PageBoundary from './components/PageBoundary.jsx';

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
            <PageBoundary name="SyncScreenplay"><SyncScreenplay /></PageBoundary>
            {/* Components that took code over from core (src/components/<Name>/react.json): mounted once, here, so
                what each provides is on window before any legacy script runs. */}
            {REACT_COMPONENTS.map(({ name, Component }) => <PageBoundary key={name} name={name}><Component /></PageBoundary>)}
        </>
    );
}
