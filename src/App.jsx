import WritingStyleWorkbench from './components/WritingStyle/WritingStyleWorkbench.jsx';
import AIWorkspace from './components/AIWorkspace/AIWorkspace.jsx';
import AskAI from './components/AIWorkspace/AskAI.jsx';
import AIConnections from './components/AIWorkspace/AIConnections.jsx';
import ReferenceCompare from './components/ReferenceCompare/ReferenceCompare.jsx';
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
            <PageBoundary name="WritingStyleWorkbench"><WritingStyleWorkbench /></PageBoundary>
            <PageBoundary name="AIWorkspace"><AIWorkspace /></PageBoundary>
            <PageBoundary name="AskAI"><AskAI /></PageBoundary>
            <PageBoundary name="AIConnections"><AIConnections /></PageBoundary>
            <PageBoundary name="ReferenceCompare"><ReferenceCompare /></PageBoundary>
            {/* Components that took code over from core (src/components/<Name>/react.json): mounted once, here, so
                what each provides is on window before any legacy script runs. */}
            {REACT_COMPONENTS.map(({ name, Component }) => <PageBoundary key={name} name={name}><Component /></PageBoundary>)}
        </>
    );
}
