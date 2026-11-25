# Fixtures

arXiv LaTeXML HTML pages, fetched with curl from `https://arxiv.org/html/<id>` on 2026-11-24. Each is licensed CC BY 4.0, as stated on its arXiv abstract page (checked 2026-11-24). The files are unmodified copies, kept so the tests run offline.

| arXiv id | License | Title | Authors |
|---|---|---|---|
| [2611.27106v1](https://arxiv.org/abs/2611.27106v1) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) | Schema-Validated LLM Workflows: A Benchmark Protocol and Comparative Evaluation Across Six Python Implementations | Sidney Shapiro, Sanad Al-Khatib, Aurora Pinzón Arzola, Emiliano Sebastian Gonzalez Venegas, Daniel Pearson |
| [2611.27139v1](https://arxiv.org/abs/2611.27139v1) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) | Do Senior Agents Do Their Job? Measuring Role Integrity in How LLM Agents Use Subordinate Material | Jinxiang Xie, Xinyi Zhang, Changjiang Jiang, Kexu Liu, Qi Yang, Yuxin Su |
| [2611.26897v1](https://arxiv.org/abs/2611.26897v1) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) | ProbeAgent: Principled Diagnosis of Agent Failures in Verifiable Environments | Yue Huang, Yuchen Ma, Shuhang Lin, Yuyang Wu, Zixuan Weng, Zixiang Xu, Xiangqi Wang, Yuexing Hao, Yujun Zhou, Yue Zhao, Olexandr Isayev, Stefan Feuerriegel, Xiangliang Zhang |

`gold/` holds a hand-written `FullRecord` and `Script` for 2611.27106 (read from the parsed paragraphs).
