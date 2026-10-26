"""Condition semantics are independent of model runtime and media decoding."""
import unittest
from skyvision_processor.service.workshopConditionInferenceService import match_condition, match_rule

class WorkshopConditions(unittest.TestCase):
    def test_overnight_window_uses_capture_timezone_and_exclusive_end(self):
        rule = {'kind': 'time', 'from': '21:00', 'until': '06:00', 'timeZone': 'America/New_York'}
        self.assertTrue(match_rule(rule, '2026-09-24T01:30:00Z', []))
        self.assertFalse(match_rule(rule, '2026-09-24T10:00:00Z', []))
        self.assertTrue(match_rule({'kind':'weekday','days':[3],'timeZone':'America/New_York'}, '2026-09-24T01:30:00Z', []))
    def test_class_filters_confidence_count_and_boolean_composition(self):
        labels=[{'class_name':'Bird','confidence':.8},{'class_name':'Plane','confidence':.9}]
        rules=[{'kind':'confidence','className':'Bird','threshold':.7,'operator':'at-least'}, {'kind':'count','className':'Bird','count':2,'operator':'at-least'}]
        self.assertTrue(match_condition({'match':'any','rules':rules}, '2026-09-24T00:00:00Z', labels))
        self.assertFalse(match_condition({'match':'all','rules':rules}, '2026-09-24T00:00:00Z', labels))
        self.assertTrue(match_rule({'kind':'class','className':'Bird','operator':'absent'}, '2026-09-24T00:00:00Z', []))

class WorkshopSampling(unittest.TestCase):
    def test_test_limit_stops_decoding_after_requested_frames(self):
        from fractions import Fraction
        from unittest.mock import patch
        from types import SimpleNamespace
        from skyvision_processor.service.workshopInferenceService import samples
        decoded=[]
        class Container:
            pos = 0
            streams=SimpleNamespace(video=[SimpleNamespace(start_time=0, time_base=Fraction(1,1))])
            def __enter__(self): return self
            def __exit__(self,*_): pass
            def seek(self, offset, **_): self.pos = int(offset)
            def decode(self,_):
                for i in range(self.pos, 600):
                    decoded.append(i)
                    yield SimpleNamespace(pts=i,time_base=Fraction(1,1),to_ndarray=lambda format:i)
                    if i >= self.pos: return
        with patch.dict('sys.modules',{'av':SimpleNamespace(open=lambda _:Container())}):
            frames=list(samples('unused',{'kind':'video','from':0,'until':60,'sample_limit':3},5))
        self.assertEqual([f[3] for f in frames],[0.,5.,10.])
        self.assertEqual(decoded[-1],10)
    def test_samples_take_the_next_keyframe_only_inside_their_slot(self):
        from fractions import Fraction
        from unittest.mock import patch
        from types import SimpleNamespace
        from skyvision_processor.service.workshopInferenceService import samples
        class FFmpegError(Exception): pass
        keys=range(0,58,3)
        class Container:
            pos=0
            streams=SimpleNamespace(video=[SimpleNamespace(start_time=0, time_base=Fraction(1,1))])
            def __enter__(self): return self
            def __exit__(self,*_): pass
            def seek(self, offset, backward, **_):
                later=[k for k in keys if k>=offset]
                if not backward and not later: raise FFmpegError()
                self.pos=max(k for k in keys if k<=offset) if backward else later[0]
            def decode(self,_):
                for i in range(self.pos, 63):
                    yield SimpleNamespace(pts=i,time_base=Fraction(1,1),to_ndarray=lambda format:None)
        av=SimpleNamespace(open=lambda _:Container(), error=SimpleNamespace(FFmpegError=FFmpegError))
        with patch.dict('sys.modules',{'av':av}):
            offsets=[f[3] for f in samples('unused',{'kind':'video','from':0,'until':62},5)]
        # Keyframes every 3 s: 6, 21, 36, 51 trail their tick by 1 s and are kept; 12, 27, 42, 57 trail by 2 s and fall
        # back to exact decode, as does 60, which has no keyframe after it.
        self.assertEqual(offsets,[0.,6.,10.,15.,21.,25.,30.,36.,40.,45.,51.,55.,60.])
    def test_graph_reports_only_steps_on_the_selected_branch(self):
        from skyvision_processor.service.workshopInferenceService import execute_graph
        nodes=[{'id':'input','data':{'kind':'input'}},{'id':'gate','data':{'kind':'condition','match':'all','rules':[{'kind':'class','className':'Bird','operator':'absent'}]}},{'id':'yes','data':{'kind':'output','bucketId':'yes-bucket'}},{'id':'no','data':{'kind':'output','bucketId':'no-bucket'}}]
        edges=[{'source':'input','sourceHandle':'out','target':'gate'},{'source':'gate','sourceHandle':'yes','target':'yes'},{'source':'gate','sourceHandle':'no','target':'no'}]
        visited=[]
        result=execute_graph({'workflow':{'nodes':nodes,'edges':edges}},None,'2026-09-24T00:00:00Z',{},'cpu',[],visited.append)
        self.assertEqual(result[0],'yes-bucket')
        self.assertEqual(visited,['input','gate','yes'])
    def test_otherwise_can_end_without_saving_a_frame(self):
        from skyvision_processor.service.workshopInferenceService import execute_graph
        nodes=[{'id':'input','data':{'kind':'input'}},{'id':'gate','data':{'kind':'condition','match':'all','rules':[{'kind':'class','className':'Bird','operator':'present'}]}},{'id':'yes','data':{'kind':'output','bucketId':'kept'}},{'id':'skip','data':{'kind':'nothing'}}]
        edges=[{'source':'input','sourceHandle':'out','target':'gate'},{'source':'gate','sourceHandle':'yes','target':'yes'},{'source':'gate','sourceHandle':'no','target':'skip'}]
        result=execute_graph({'workflow':{'nodes':nodes,'edges':edges}},None,'2026-09-24T00:00:00Z',{},'cpu',[])
        self.assertEqual(result[0], None)
        self.assertEqual(result[2], 'skip')
    def test_later_model_runs_only_frames_that_reach_it(self):
        from skyvision_processor.service.workshopInferenceService import stage_recording
        nodes=[{'id':'input','data':{'kind':'input'}},{'id':'first','data':{'kind':'model'}},{'id':'gate','data':{'kind':'condition','match':'all','rules':[{'kind':'class','className':'WildLife','operator':'present'}]}},{'id':'second','data':{'kind':'model'}},{'id':'keep','data':{'kind':'output','bucketId':'kept'}},{'id':'skip','data':{'kind':'nothing'}}]
        edges=[{'source':'input','sourceHandle':'out','target':'first'},{'source':'first','sourceHandle':'out','target':'gate'},{'source':'gate','sourceHandle':'yes','target':'second'},{'source':'gate','sourceHandle':'no','target':'skip'},{'source':'second','sourceHandle':'out','target':'keep'}]
        calls=[]
        def predict(node_id, images):
            calls.append((node_id, len(images)))
            if node_id=='first': return [[{'class_name':'WildLife'}] if image=='animal' else [] for image in images]
            return [[{'class_name':'Bird'}] for _ in images]
        frames=[{'image':name,'pts':i,'time_base':[1,1],'offset':float(i),'captured':'2026-09-24T12:00:00Z'} for i,name in enumerate(['sky','animal','cloud'])]
        done=stage_recording({'workflow':{'nodes':nodes,'edges':edges}}, frames, predict)
        # Frames per model, whatever the batch size; the second model runs only after the first finished.
        self.assertEqual([(n, sum(c for m, c in calls if m == n)) for n in ('first', 'second')], [('first', 3), ('second', 1)])
        self.assertEqual(calls[-1][0], 'second')
        self.assertEqual([item['bucket'] for item in done], [None, 'kept', None])
    def test_a_camera_gap_leaves_its_slots_empty_instead_of_reusing_a_later_frame(self):
        from fractions import Fraction
        from unittest.mock import patch
        from types import SimpleNamespace
        from skyvision_processor.service.workshopInferenceService import samples
        class FFmpegError(Exception): pass
        def open_clip(pts):
            class Container:
                pos=0
                streams=SimpleNamespace(video=[SimpleNamespace(start_time=0, time_base=Fraction(1,10))])
                def __enter__(self): return self
                def __exit__(self,*_): pass
                def seek(self, offset, backward, **_):
                    later=[k for k in pts if k>=offset]
                    if not backward and not later: raise FFmpegError()
                    self.pos=max(k for k in pts if k<=offset) if backward else later[0]
                def decode(self,_):
                    for i in pts:
                        if i>=self.pos: yield SimpleNamespace(pts=i,time_base=Fraction(1,10),to_ndarray=lambda format:None)
            return SimpleNamespace(open=lambda _:Container(), error=SimpleNamespace(FFmpegError=FFmpegError))
        # The recorder stalled from 0.5 s to 3.7 s: slots 1 and 2 have no frame of their own.
        with patch.dict('sys.modules',{'av':open_clip([0,5,37,42,47,52,57])}):
            offsets=[f and f[3] for f in samples('unused',{'kind':'video','from':0,'until':6},1)]
        self.assertEqual(offsets,[0.,None,None,3.7,4.2,5.2])
        # A clip that stops early proves no gap, so it still fails instead of reporting empty slots.
        with patch.dict('sys.modules',{'av':open_clip([0,5,12])}), self.assertRaises(ValueError):
            list(samples('unused',{'kind':'video','from':0,'until':4},1))
    def test_empty_slots_are_reported_and_skipped_in_progress(self):
        import sys
        from types import SimpleNamespace
        from unittest.mock import patch
        from skyvision_processor.service import workshopInferenceService as w
        cv2 = SimpleNamespace(IMWRITE_JPEG_QUALITY=1, imencode=lambda ext, image, params: (True, SimpleNamespace(tobytes=lambda: b'jpeg')))
        torch = SimpleNamespace(set_num_threads=lambda n: None, cuda=SimpleNamespace(is_available=lambda: False), backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: False)))
        frame = SimpleNamespace(shape=(4, 6, 3))
        nodes=[{'id':'input','data':{'kind':'input'}},{'id':'frame','data':{'kind':'footage'}},{'id':'photo','data':{'kind':'output','bucketId':'b'}}]
        edges=[{'source':'input','sourceHandle':'out','target':'frame'},{'source':'frame','sourceHandle':'out','target':'photo'}]
        job={'id':'j','input':{'kind':'video','recording':{'sha256':'a'*64,'size':1,'start':'2026-09-24T12:00:00Z'},'item':None,'from':0.,'until':5.},
             'snapshot':{'runtime':{'code_sha256':'f'},'models':[],'interval':1,'workflow':{'nodes':nodes,'edges':edges}}}
        progress,completed=[],{}
        sampled=[(frame,0,[1,10],0.),None,None,(frame,37,[1,10],3.7),None]
        with patch.dict(sys.modules, {'cv2': cv2, 'torch': torch}), patch.object(w.ops,'claim',return_value=job), patch.object(w.ops,'download'), patch.object(w.ops,'heartbeat'), \
             patch.object(w.ops,'progress',side_effect=lambda c,j,p: progress.append(p)), patch.object(w.ops,'upload',return_value='b'*64), \
             patch.object(w.ops,'complete',side_effect=lambda c,j,r: completed.update(r) or {'status':'completed'}), \
             patch.object(w,'samples',return_value=iter(sampled)):
            w.run_workshop(None,'runtime','f')
        self.assertEqual((completed['sampled_frames'],completed['empty_slots']),(2,[1,2,4]))
        self.assertEqual([f['offset'] for f in completed['frames']],[0.,3.7])
        # The server accepts a frame only as the next slot, so the empty slots are reported before it, and at the end.
        steps=[(p['processed'],p.get('sequence'),p.get('empty')) for p in progress if p['phase'] in ('processing','finalizing') and p['processed']]
        self.assertEqual(steps,[(1,0,None),(3,None,True),(4,3,None),(5,None,True),(5,None,None)])
    def test_photo_job_saves_one_plain_frame_without_a_model(self):
        import sys
        from types import SimpleNamespace
        from unittest.mock import patch
        from skyvision_processor.service import workshopInferenceService as w
        # Stand-ins for the media and model libraries, which CI does not install.
        cv2 = SimpleNamespace(IMWRITE_JPEG_QUALITY=1, imencode=lambda ext, image, params: (True, SimpleNamespace(tobytes=lambda: b'jpeg')))
        torch = SimpleNamespace(set_num_threads=lambda n: None, cuda=SimpleNamespace(is_available=lambda: False), backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: False)))
        frame = SimpleNamespace(shape=(4, 6, 3))
        nodes=[{'id':'input','data':{'kind':'input'}},{'id':'frame','data':{'kind':'footage'}},{'id':'photo','data':{'kind':'output','bucketId':'camera-archive'}}]
        edges=[{'source':'input','sourceHandle':'out','target':'frame'},{'source':'frame','sourceHandle':'out','target':'photo'}]
        job={'id':'j','input':{'kind':'video','recording':{'sha256':'a'*64,'size':1,'start':'2026-09-24T12:00:00Z'},'item':None,'from':5.,'until':6.,'sample_limit':1},
             'snapshot':{'runtime':{'code_sha256':'f'},'models':[],'interval':1,'workflow':{'nodes':nodes,'edges':edges}}}
        progress,completed=[],{}
        with patch.dict(sys.modules, {'cv2': cv2, 'torch': torch}), patch.object(w.ops,'claim',return_value=job), patch.object(w.ops,'download'), patch.object(w.ops,'heartbeat'), \
             patch.object(w.ops,'progress',side_effect=lambda c,j,p: progress.append(p)), patch.object(w.ops,'upload',return_value='b'*64), \
             patch.object(w.ops,'complete',side_effect=lambda c,j,r: completed.update(r) or {'status':'completed'}), \
             patch.object(w,'samples',return_value=iter([(frame,500,[1,100],5.)])):
            w.run_workshop(None,'runtime','f')
        self.assertEqual(completed['sampled_frames'],1)
        self.assertEqual([(f['bucket_id'],f['model_node'],f['annotations'],f['width']) for f in completed['frames']],[('camera-archive',None,[],6)])
        self.assertTrue(all(p['node_id'] is None for p in progress))
    def test_one_recording_holds_decoded_frames_at_a_time_and_a_failure_lets_go(self):
        import sys
        from types import SimpleNamespace
        from unittest.mock import patch
        from skyvision_processor.service import workshopInferenceService as w
        cv2 = SimpleNamespace(IMWRITE_JPEG_QUALITY=1, imencode=lambda ext, image, params: (True, SimpleNamespace(tobytes=lambda: b'jpeg')))
        torch = SimpleNamespace(set_num_threads=lambda n: None, cuda=SimpleNamespace(is_available=lambda: False), backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: False)))
        nodes=[{'id':'input','data':{'kind':'input'}},{'id':'frame','data':{'kind':'footage'}},{'id':'photo','data':{'kind':'output','bucketId':'b'}}]
        edges=[{'source':'input','sourceHandle':'out','target':'frame'},{'source':'frame','sourceHandle':'out','target':'photo'}]
        job={'id':'j','input':{'kind':'video','recording':{'sha256':'a'*64,'size':1,'start':'2026-09-24T12:00:00Z'},'item':None,'from':0.,'until':2.},
             'snapshot':{'runtime':{'code_sha256':'f'},'models':[],'interval':1,'workflow':{'nodes':nodes,'edges':edges}}}
        events = []
        guard = SimpleNamespace(acquire=lambda: events.append('acquire'), release=lambda: events.append('release'))
        def decoded(*_):
            events.append('decode')
            yield (SimpleNamespace(shape=(4, 6, 3)), 0, [1, 10], 0.)
            yield (SimpleNamespace(shape=(4, 6, 3)), 10, [1, 10], 1.)
        def broken(*_):
            events.append('decode')
            raise ValueError('decode failed')
            yield
        with patch.dict(sys.modules, {'cv2': cv2, 'torch': torch}), patch.object(w, '_frames', guard), patch.object(w.ops,'claim',return_value=job), \
             patch.object(w.ops,'download'), patch.object(w.ops,'heartbeat'), patch.object(w.ops,'progress'), patch.object(w.ops,'fail'), \
             patch.object(w.ops,'upload',return_value='b'*64), patch.object(w.ops,'complete',side_effect=lambda c,j,r: events.append('complete') or {'status':'completed'}):
            with patch.object(w, 'samples', side_effect=decoded):
                w.run_workshop(None,'runtime','f')
            with patch.object(w, 'samples', side_effect=broken), self.assertRaises(ValueError):
                w.run_workshop(None,'runtime','f')
        self.assertEqual(events, ['acquire', 'decode', 'complete', 'release', 'acquire', 'decode', 'release'])
