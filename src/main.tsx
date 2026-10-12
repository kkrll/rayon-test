import { render } from 'solid-js/web';
import { initAnalytics } from './analytics';
import { App } from './ui/App';
import './styles.css';

initAnalytics();

render(() => <App />, document.getElementById('root')!);
