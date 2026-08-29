import { FakeService } from './embeddedGatewayFixture'
import { harnessBackendConformance } from '../testing/harnessBackendConformance'

harnessBackendConformance({
  name: 'in-memory',
  replayGapCase: true,
  createBackend: () => ({ backend: new FakeService(5, true) }),
})
