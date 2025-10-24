/*
 * @author Jim Robinson Dec-2020
 */

import "./utils/mockObjects.js"
import { describe, it, expect } from 'vitest'

import {extractConfig} from "../js/urlUtils.js";

describe("testURLs", () => {


    it("Session blob", async () => {

        const url = "http://aidenlab.org/juicebox/?session=blob:1ZPPbtswDMbfxacNECRR_51b0Qwb1tPS24bAUGylMWpbmaS1w4q8e.UYS5d06C7JYRfC_kRTP9Ifn4pV8I_RhVjMvj0VP0JXzIpNSts4IyRybHv7yw_2MeLa92TT1uu2czE_RPedDLc_N5._fmrmiy_0_uN8QYBhDhg0uZpfXe9DxSnOXxWoGGzvcu1jMSabRpUhhhQCUyoMUjHJNQetmURQgsJKajAgGdfaIMBSMM4MPUR0s8ilat_5cFvbbqwHQmAGhmsBwuQkLRCTElFER5KHNqfo0pRQCiryJUbpMh.kYOv7CwyiHZILuemq9kOydaoa39t2iERSSqtV58dbDxM6FvdtZTXcrd6NLezbeF_s0HkZq877bSS9C3eumV7wyjVb98L117M_8SjiauS7AN1DrD4Mjb8mTbteu.CG1NpuQoFTzrdSjnHHWXKVcZfnBJ5A9_GV.0_Uy9mfYa0FL0VeAloa_tr.yoCRzAAVl7T_1O8ZvAUm05_dW9Ov.h_W840FYP9egJeUk5n.xl3ulrtn"

        const sessionJSON = await extractConfig(url);
        expect(sessionJSON.browsers.length).toBe(2);

        const browser1 = sessionJSON.browsers[0];
        expect(browser1.name).toBe("ADAC_30.hic");
        expect(browser1.tracks.length).toBe(3);

    })

    it("parameters", async () => {

        const url = "http://www.aidenlab.org/juicebox/?state=3,3,6,5537.98746,5537.749239047619,1,KR&colorScale=18.89619862813927&hicUrl=https://s3.amazonaws.com/hicfiles/external/wapl_hic/WT.hic&name=Haarhuis%20et%20al.%20|%20Cell%202017%20Hap1%20control&tracks=http://hicfiles.s3.amazonaws.com/external/GM12878_CTCF_orientation.bed|GM12878_CTCF_orientation.bed||rgb(22,%20129,%20198)|||https://s3.amazonaws.com/igv.broadinstitute.org/annotations/hg19/genes/gencode.v18.collapsed.bed.gz|gencode.v18.collapsed.bed.gz||rgb(22,%20129,%20198)"

        const config = await extractConfig(url);

        expect(config.url).toBe("https://s3.amazonaws.com/hicfiles/external/wapl_hic/WT.hic");
        expect(config.name).toBe("Haarhuis et al. | Cell 2017 Hap1 control");

        const state = config.state;
        expect(state.chr1).toBe("3");
        expect(state.chr2).toBe("3");
        expect(state.x).toBe(5537.98746);
        expect(state.y).toBe(5537.749239047619);
        expect(state.normalization).toBe("KR");

        expect(config.tracks.length).toBe(2);

    })

    it("'juicebox' parameter", async () => {

        const url = "http://aidenlab.org/juicebox/?juicebox={hicUrl%3Dhttps%3A%2F%2Fs3.amazonaws.com%2Fhicfiles%2Fhiseq%2FnSxhJZHdDRQ0kGDR%2F12.31.17%2FADAC%2FADAC_30.hic%26name%3DADAC_30.hic%26state%3D2%2C2%2C6%2C1896.1562537317725%2C1916.657181523778%2C1.5423280423280423%2CKR%26colorScale%3D144.21837414880474%2C255%2C0%2C0%26nvi%3D7989194045%2C18679%26tracks%3Dhttps%3A%2F%2Fs3.amazonaws.com%2Fhicfiles%2Fhiseq%2FnSxhJZHdDRQ0kGDR%2F12.31.17%2FADAC%2Finter_30_contact_domains%2F5000_blocks%7C5000_blocks%7C%7Crgb(255%2C255%2C0)%7C%7C%7Chttps%3A%2F%2Fs3.amazonaws.com%2Fhicfiles%2Fhiseq%2FnSxhJZHdDRQ0kGDR%2F12.31.17%2FADAC_loops%2Fmerged_loops.bedpe%7Cmerged_loops.bedpe%7C%7Crgb(0%2C36%2C255)%7C%7C%7Chttps%3A%2F%2Fs3.amazonaws.com%2Fhicfiles%2Fhiseq%2FnSxhJZHdDRQ0kGDR%2F12.31.17%2FADAC_vs_EndoC%2Fdifferential_loops1.bedpe%7Cdifferential_loops1.bedpe%7C%7Crgb(0%2C255%2C36)},{hicUrl%3Dhttps%3A%2F%2Fs3.amazonaws.com%2Fhicfiles%2Fhiseq%2FnSxhJZHdDRQ0kGDR%2F12.31.17%2FEndoC%2FEndoC_30.hic%26name%3DEndoC_30.hic%26state%3D2%2C2%2C6%2C1896.1562537317725%2C1916.657181523778%2C1.5423280423280423%2CKR%26colorScale%3D142.77439421809834%2C255%2C0%2C0%26nvi%3D6818528104%2C18679%26tracks%3Dhttps%3A%2F%2Fs3.amazonaws.com%2Fhicfiles%2Fhiseq%2FnSxhJZHdDRQ0kGDR%2F12.31.17%2FEndoC_loops%2Fmerged_loops.bedpe%7Cmerged_loops.bedpe%7C%7Crgb(18%2C0%2C255)%7C%7C%7Chttps%3A%2F%2Fs3.amazonaws.com%2Fhicfiles%2Fhiseq%2FnSxhJZHdDRQ0kGDR%2F12.31.17%2FEndoC%2Finter_30_contact_domains%2F5000_blocks%7C5000_blocks%7C%7Crgb(255%2C255%2C0)%7C%7C%7Chttps%3A%2F%2Fs3.amazonaws.com%2Fhicfiles%2Fhiseq%2FnSxhJZHdDRQ0kGDR%2F12.31.17%2FADAC_vs_EndoC%2Fdifferential_loops2.bedpe%7Cdifferential_loops2.bedpe%7C%7Crgb(18%2C255%2C0)}";

        const sessionJSON = await extractConfig(url);
        expect(sessionJSON.browsers.length).toBe(2);

        const browser1 = sessionJSON.browsers[0];
        expect(browser1.name).toBe("ADAC_30.hic");
        expect(browser1.tracks.length).toBe(3);

    })

    it("juiceboxURL'", async () => {

        const url = "http://localhost/juicebox-web/index.html?juiceboxURL=http://bit.ly/2C1VSHy";

        const sessionJSON = await extractConfig(url);

        expect(sessionJSON.browsers.length).toBe(2);

        const browser1 = sessionJSON.browsers[0];
        expect(browser1.name).toBe("ADAC_30.hic");
        expect(browser1.tracks.length).toBe(3);

    })

})
